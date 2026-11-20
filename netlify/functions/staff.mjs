// POST /.netlify/functions/staff   header: x-staff-pin
// { action:'list' } | { action:'checkin', ticketId } | { action:'undo', ticketId } | { action:'cash', seats, customer }
import { timingSafeEqual } from 'node:crypto';
import { json, fail, readBody, env, newRef, newKey } from '../lib/http.mjs';
import { seatInfo } from '../lib/hall.mjs';
import { rpc } from '../lib/supabase.mjs';
import { addVerify, siteOrigin } from '../lib/tickets.mjs';
import { sendConfirmation } from '../lib/email.mjs';

const pinOk = given => {
  const pin = env('STAFF_PIN');
  if (!pin || pin.length < 6) return false;              // refuse weak / missing PINs
  const a = Buffer.from(String(given || '')), b = Buffer.from(pin);
  return a.length === b.length && timingSafeEqual(a, b);
};

export default async (req) => {
  if (req.method !== 'POST') return fail('METHOD', 'Use POST', 405);
  if (!pinOk(req.headers.get('x-staff-pin'))) {
    await new Promise(r => setTimeout(r, 800));            // slow down PIN guessing
    return fail('PIN', 'Wrong staff PIN.', 401);
  }
  const body = await readBody(req).catch(() => ({}));
  try {
    switch (body.action) {
      case 'login':   return json({ ok: true });
      case 'list':    return json({ bookings: (await rpc('wv_staff_bookings')).map(b => addVerify(b, siteOrigin(req))) });
      case 'email':   return json({ result: await sendConfirmation(String(body.ref || ''), siteOrigin(req), { force: true }) });
      case 'checkin': return json(await rpc('wv_check_in', { p_ticket_id: String(body.ticketId || '') }));
      case 'undo':    return json({ booking: await rpc('wv_undo_check_in', { p_ticket_id: String(body.ticketId || '') }) });
      case 'cash': {
        const seats = [...new Set(body.seats || [])].map(seatInfo);
        if (!seats.length || seats.some(s => !s)) return fail('BAD_SEAT', 'Check the seat numbers.');
        const c = body.customer || {};
        const customer = { first: String(c.first || 'Office').slice(0, 40), last: String(c.last || 'sale').slice(0, 40),
          phone: String(c.phone || '').slice(0, 20), email: String(c.email || '').slice(0, 120), role: 'Cash sale', student: String(c.student || '').slice(0, 80) };
        const booking = await rpc('wv_record_cash_sale', { p_ref: newRef(), p_access_key: newKey(),
          p_amount: seats.reduce((a, s) => a + s.price, 0), p_seats: seats, p_customer: customer });
        let email = 'no-email';
        if (customer.email) email = await sendConfirmation(booking.ref, siteOrigin(req)).catch(e => (console.error('[email]', e.message), 'failed'));
        return json({ booking: addVerify(booking, siteOrigin(req)), email });
      }
      default: return fail('ACTION', 'Unknown action');
    }
  } catch (e) {
    if (e.message.startsWith('SEAT_TAKEN:')) return json({ error: 'SEAT_TAKEN', message: `Already sold: ${e.message.split(':')[1]}` }, 409);
    return fail('DB', e.message, e.status || 500);
  }
};
