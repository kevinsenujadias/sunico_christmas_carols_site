// POST /.netlify/functions/create-order  { customer, seats:['C4','C5'] }
// Reserves the seats for a few minutes, prices them ON THE SERVER, and signs the PayHere payment.
import { json, fail, readBody, newRef, newKey, env, isConfigured, isSandbox, monthlyCap, holdMinutes } from '../lib/http.mjs';
import { seatInfo, TIERS } from '../lib/hall.mjs';
import { checkoutHash, fmtAmount } from '../lib/payhere.mjs';
import { rpc } from '../lib/supabase.mjs';

const MAX_SEATS = 10;
const clean = (v, n = 80) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);

export default async (req) => {
  if (req.method !== 'POST') return fail('METHOD', 'Use POST', 405);
  if (!isConfigured()) return fail('NOT_CONFIGURED', 'Online payments are not switched on yet.', 503);
  let body; try { body = await readBody(req); } catch { return fail('BAD_JSON', 'Bad request'); }

  // customer details
  const c = body.customer || {};
  const customer = {
    first: clean(c.first, 40), last: clean(c.last, 40), email: clean(c.email, 120),
    phone: clean(c.phone, 20), role: clean(c.role, 40), student: clean(c.student, 80),
  };
  if (!customer.first || !customer.last) return fail('NAME', 'Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) return fail('EMAIL', 'Please enter a valid email.');
  if (customer.phone.replace(/\D/g, '').length < 9) return fail('PHONE', 'Please enter a valid phone number.');

  // seats: real seats only, no repeats, priced here (never trust a price sent by the browser)
  const ids = [...new Set((Array.isArray(body.seats) ? body.seats : []).map(s => String(s).toUpperCase()))];
  if (!ids.length) return fail('NO_SEATS', 'Pick at least one seat.');
  if (ids.length > MAX_SEATS) return fail('TOO_MANY', `You can book up to ${MAX_SEATS} seats at a time.`);
  const seats = ids.map(seatInfo);
  if (seats.some(s => !s)) return fail('BAD_SEAT', 'One of those seats does not exist.');
  const amount = seats.reduce((a, s) => a + s.price, 0);

  const ref = newRef(), accessKey = newKey();
  let booking;
  try {
    booking = await rpc('wv_create_pending_booking', {
      p_ref: ref, p_access_key: accessKey, p_amount: amount, p_seats: seats, p_customer: customer,
      p_month_cap: monthlyCap(), p_hold_minutes: holdMinutes(),
    });
  } catch (e) {
    if (e.message.startsWith('SEAT_TAKEN:')) {
      const taken = e.message.split(':')[1].split(',');
      return json({ error: 'SEAT_TAKEN', taken, message: `Sorry, ${taken.join(', ')} ${taken.length > 1 ? 'were' : 'was'} just booked by someone else.` }, 409);
    }
    if (e.message.startsWith('ONLINE_LIMIT')) {
      return json({ error: 'ONLINE_LIMIT', message: 'Online ticket sales are full for this month. Please buy your tickets at the school office.' }, 409);
    }
    return fail('DB', 'Could not reserve your seats. Please try again.', e.status || 500);
  }

  const merchantId = env('PAYHERE_MERCHANT_ID'), currency = 'LKR';
  const origin = (env('SITE_URL') || new URL(req.url).origin).replace(/\/$/, '');
  const byTier = Object.entries(seats.reduce((m, s) => ((m[s.tier] = (m[s.tier] || 0) + 1), m), {}))
    .map(([t, n]) => `${n} ${TIERS[t].label}`).join(', ');

  // Everything the PayHere popup needs (see https://support.payhere.lk/api-&-mobile-sdk/javascript-sdk)
  const payment = {
    sandbox: isSandbox(),
    merchant_id: merchantId,
    return_url: undefined,          // popup mode
    cancel_url: undefined,
    notify_url: `${origin}/.netlify/functions/payhere-notify`,
    order_id: ref,
    items: `Winter Vespers 2026 tickets: ${byTier} (${ids.join(', ')})`.slice(0, 250),
    amount: fmtAmount(amount),
    currency,
    hash: checkoutHash({ merchantId, orderId: ref, amount, currency, secret: env('PAYHERE_MERCHANT_SECRET') }),
    first_name: customer.first, last_name: customer.last, email: customer.email, phone: customer.phone,
    address: 'SUNICO', city: 'Colombo', country: 'Sri Lanka',
    custom_1: ids.join(','),
  };
  return json({ booking, accessKey, payment });
};
