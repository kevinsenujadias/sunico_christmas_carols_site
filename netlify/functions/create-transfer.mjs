// POST /.netlify/functions/create-transfer  { customer, seats:['C4','C5'] }
// Bank transfer: holds the seats (default 24 hours) and returns the school's bank details
// plus the booking number the buyer must write in the transfer remarks.
// The booking only becomes "paid" when a staff member sees the money in the school account and approves it.
import { json, fail, readBody, newRef, newKey, bankOn, bankDetails, bankHoldHours, clientIp } from '../lib/http.mjs';
import { rpc } from '../lib/supabase.mjs';
import { checkOrder, orderError } from '../lib/order.mjs';

export default async (req) => {
  if (req.method !== 'POST') return fail('METHOD', 'Use POST', 405);
  if (!bankOn()) return fail('NOT_CONFIGURED', 'Bank transfer is not switched on yet.', 503);
  let body; try { body = await readBody(req); } catch { return fail('BAD_JSON', 'Bad request'); }
  const o = checkOrder(body); if (o.error) return o.error;
  const { customer, seats, amount } = o;

  const ref = newRef(), accessKey = newKey();
  try {
    const booking = await rpc('wv_create_bank_booking', {
      p_ref: ref, p_access_key: accessKey, p_amount: amount, p_seats: seats, p_customer: customer,
      p_hold_hours: bankHoldHours(), p_ip: clientIp(req),
    });
    return json({ booking, accessKey, bank: bankDetails() });
  } catch (e) { return orderError(e); }
};
