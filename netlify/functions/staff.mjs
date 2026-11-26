// POST /.netlify/functions/staff
//   sign in:  { action:'login', pin }                 -> { pass }   (pass goes in the x-staff-pass header after that)
//   then:     { action:'list' } | { action:'checkin', ticketId } | { action:'undo', ticketId }
//             { action:'cash', seats, customer } | { action:'email', ref }
//             { action:'slip', ref } | { action:'approve', ref, note } | { action:'reject', ref, note }
import { json, fail, readBody, newRef, newKey, clientIp } from '../lib/http.mjs';
import { seatInfo } from '../lib/hall.mjs';
import { rpc } from '../lib/supabase.mjs';
import { addVerify, siteOrigin } from '../lib/tickets.mjs';
import { sendConfirmation } from '../lib/email.mjs';
import { sendSms } from '../lib/sms.mjs';
import { slipLink } from '../lib/storage.mjs';
import { tryPin, makePass, passOk, pinStrongEnough } from '../lib/staffauth.mjs';
import { clean } from '../lib/order.mjs';

const refOf = v => String(v || '').toUpperCase().trim().slice(0, 20);
// the full booking (with its private key) for building the buyer's link
const full = ref => rpc('wv_email_payload', { p_ref: ref });
const mail = (ref, req) => sendConfirmation(ref, siteOrigin(req)).catch(e => (console.error('[email]', e.message), 'failed'));

export default async (req) => {
  if (req.method !== 'POST') return fail('METHOD', 'Use POST', 405);
  const body = await readBody(req).catch(() => ({}));

  if (body.action === 'login') {
    if (!pinStrongEnough()) return fail('PIN_SETUP', 'The staff PIN is not set up safely yet (it needs at least 6 digits).', 503);
    const r = await tryPin(body.pin, clientIp(req));
    if (!r.ok) {
      await new Promise(res => setTimeout(res, 700));                     // slow down guessing
      return r.locked ? fail('LOCKED', `Too many wrong PINs. Try again in ${r.locked} minute${r.locked > 1 ? 's' : ''}.`, 429)
                      : fail('PIN', 'Wrong staff PIN.', 401);
    }
    return json({ pass: makePass() });
  }
  if (!passOk(req.headers.get('x-staff-pass'))) return fail('SIGNED_OUT', 'Please sign in again with the staff PIN.', 401);

  try {
    switch (body.action) {
      case 'list':    return json({ bookings: (await rpc('wv_staff_bookings')).map(b => addVerify(b, siteOrigin(req))) });
      case 'email':   return json({ result: await sendConfirmation(refOf(body.ref), siteOrigin(req), { force: true }) });
      case 'checkin': return json(await rpc('wv_check_in', { p_ticket_id: String(body.ticketId || '').slice(0, 30) }));
      case 'undo':    return json({ booking: await rpc('wv_undo_check_in', { p_ticket_id: String(body.ticketId || '').slice(0, 30) }) });

      // ---- bank transfers ----
      case 'slip': {
        const path = await rpc('wv_slip_path', { p_ref: refOf(body.ref) });
        if (!path) return fail('NO_SLIP', 'No slip uploaded for this booking.', 404);
        return json({ url: await slipLink(path), pdf: path.endsWith('.pdf') });
      }
      case 'approve': {
        const before = await full(refOf(body.ref));
        const booking = await rpc('wv_approve_transfer', { p_ref: refOf(body.ref), p_note: clean(body.note, 200) });
        const email = booking.customer?.email ? await mail(booking.ref, req) : 'no-email';
        const sms = before?.status !== 'paid' ? await sendSms('approved', await full(booking.ref), siteOrigin(req)) : 'already';
        return json({ booking: addVerify(booking, siteOrigin(req)), email, sms });
      }
      case 'reject': {
        const booking = await rpc('wv_reject_transfer', { p_ref: refOf(body.ref), p_note: clean(body.note, 200) });
        const sms = await sendSms('rejected', await full(booking.ref), siteOrigin(req));
        return json({ booking, sms });
      }
      case 'sms': {                                         // staff: text the ticket link again
        const b = await full(refOf(body.ref));
        if (!b) return fail('NO_BOOKING', 'Booking not found.', 404);
        if (!['paid', 'cash'].includes(b.status)) return fail('NOT_PAID', 'This booking is not paid yet.', 409);
        return json({ result: await sendSms(b.status === 'cash' ? 'cash' : 'approved', b, siteOrigin(req)) });
      }

      case 'cash': {
        const seats = [...new Set(body.seats || [])].slice(0, 20).map(seatInfo);
        if (!seats.length || seats.some(s => !s)) return fail('BAD_SEAT', 'Check the seat numbers.');
        const c = body.customer || {};
        const customer = { first: clean(c.first, 40) || 'Office', last: clean(c.last, 40) || 'sale',
          phone: clean(c.phone, 20), email: clean(c.email, 120), role: 'Cash sale', student: clean(c.student, 80) };
        const booking = await rpc('wv_record_cash_sale', { p_ref: newRef(), p_access_key: newKey(),
          p_amount: seats.reduce((a, s) => a + s.price, 0), p_seats: seats, p_customer: customer });
        const email = customer.email ? await mail(booking.ref, req) : 'no-email';
        const sms = customer.phone ? await sendSms('cash', await full(booking.ref), siteOrigin(req)) : 'no-mobile';
        return json({ booking: addVerify(booking, siteOrigin(req)), email, sms });
      }
      default: return fail('ACTION', 'Unknown action');
    }
  } catch (e) {
    const m = e.message || '';
    if (m.startsWith('SEAT_TAKEN:')) return json({ error: 'SEAT_TAKEN', message: `Already sold to someone else: ${m.split(':')[1]}. Contact the buyer to choose other seats or refund.` }, 409);
    if (m.startsWith('NOT_WAITING')) return fail('NOT_WAITING', 'This booking is not waiting for a transfer any more (it may already be approved or rejected).', 409);
    if (m.startsWith('NO_BOOKING')) return fail('NO_BOOKING', 'Booking not found.', 404);
    console.error('[staff]', m);
    return fail('DB', 'Something went wrong. Please try again.', e.status || 500);
  }
};
