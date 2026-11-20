import { createHash, timingSafeEqual } from 'node:crypto';

const md5U = s => createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();

/** PayHere wants amounts like "4750.00" (2 decimals, no commas). */
export const fmtAmount = n => Number(n).toFixed(2);

/** Checkout hash: UPPER(md5(merchant_id + order_id + amount + currency + UPPER(md5(merchant_secret)))) */
export function checkoutHash({ merchantId, orderId, amount, currency, secret }) {
  return md5U(merchantId + orderId + fmtAmount(amount) + currency + md5U(secret));
}

/** Verify PayHere's notification:
 *  md5sig = UPPER(md5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPER(md5(merchant_secret)))) */
export function verifyNotify(f, { merchantId, secret }) {
  if (!f || !f.md5sig) return false;
  if (String(f.merchant_id) !== String(merchantId)) return false;
  const local = md5U(String(f.merchant_id) + f.order_id + f.payhere_amount + f.payhere_currency + f.status_code + md5U(secret));
  const a = Buffer.from(local), b = Buffer.from(String(f.md5sig).toUpperCase());
  return a.length === b.length && timingSafeEqual(a, b);
}
