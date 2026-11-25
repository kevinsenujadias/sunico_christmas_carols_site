// POST /.netlify/functions/create-order  { customer, seats:['C4','C5'] }
// Reserves the seats for a few minutes, prices them ON THE SERVER, and signs the PayHere payment.
import { json, fail, readBody, newRef, newKey, env, payhereOn, isSandbox, monthlyCap, holdMinutes } from '../lib/http.mjs';
import { TIERS } from '../lib/hall.mjs';
import { checkoutHash, fmtAmount } from '../lib/payhere.mjs';
import { rpc } from '../lib/supabase.mjs';
import { checkOrder, orderError } from '../lib/order.mjs';

export default async (req) => {
  if (req.method !== 'POST') return fail('METHOD', 'Use POST', 405);
  if (!payhereOn()) return fail('NOT_CONFIGURED', 'Card payments are not switched on.', 503);
  let body; try { body = await readBody(req); } catch { return fail('BAD_JSON', 'Bad request'); }
  const o = checkOrder(body); if (o.error) return o.error;
  const { customer, seats, ids, amount } = o;

  const ref = newRef(), accessKey = newKey();
  let booking;
  try {
    booking = await rpc('wv_create_pending_booking', {
      p_ref: ref, p_access_key: accessKey, p_amount: amount, p_seats: seats, p_customer: customer,
      p_month_cap: monthlyCap(), p_hold_minutes: holdMinutes(),
    });
  } catch (e) { return orderError(e); }

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
