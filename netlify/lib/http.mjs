import { randomBytes } from 'node:crypto';
export const env = k => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
export const fail = (code, message, status = 400) => json({ error: code, message }, status);

export async function readBody(req) {
  const type = req.headers.get('content-type') || '';
  if (type.includes('application/json')) return req.json();
  if (type.includes('form')) return Object.fromEntries(new URLSearchParams(await req.text()));
  const t = await req.text();
  try { return JSON.parse(t); } catch { return Object.fromEntries(new URLSearchParams(t)); }
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // no 0/O/1/I
export const newRef = () => 'WV-' + [...randomBytes(6)].map(b => ALPHA[b % ALPHA.length]).join('');
export const newKey = () => randomBytes(18).toString('base64url');

// ---- what is switched on ----
export const dbReady = () => !!(env('SUPABASE_URL') && env('SUPABASE_SECRET_KEY'));
export const bankReal = () => !!(env('BANK_NAME') && env('BANK_ACCOUNT_NAME') && env('BANK_ACCOUNT_NO'));
// Until the school's account details are added in Netlify, buyers see these SAMPLE details
// with a clear "don't transfer" warning, so the whole flow can be tested.
const SAMPLE_BANK = { bank: 'Sample Bank PLC', branch: 'Sample branch', accountName: 'SUNICO (sample account)', accountNo: '0000 0000 0000', sample: true };
export const bankReady = () => true;
export const payhereKeys = () => !!(env('PAYHERE_MERCHANT_ID') && env('PAYHERE_MERCHANT_SECRET'));
/** PAYMENT_METHODS = "bank", "payhere" or "bank,payhere". Default: bank if bank details are set, otherwise PayHere. */
export const methods = () => {
  const want = String(env('PAYMENT_METHODS') || 'bank').toLowerCase().split(/[\s,]+/);
  return ['bank', 'payhere'].filter(m => want.includes(m) && (m === 'bank' ? bankReady() : payhereKeys()));
};
export const payhereOn = () => dbReady() && methods().includes('payhere');
export const bankOn = () => dbReady() && methods().includes('bank');
/** the live site works when the database is connected and at least one way to pay is switched on */
export const isConfigured = () => dbReady() && methods().length > 0;
export const bankDetails = () => bankReal() ? {
  bank: env('BANK_NAME'), branch: env('BANK_BRANCH') || '', accountName: env('BANK_ACCOUNT_NAME'), accountNo: env('BANK_ACCOUNT_NO'),
} : SAMPLE_BANK;
export const bankHoldHours = () => Math.min(168, Math.max(1, Number(env('BANK_HOLD_HOURS') || 24)));
export const testMode = () => env('TEST_MODE') === 'true' || (bankOn() && !bankReal()) || (payhereOn() && isSandbox());
/** the visitor's IP (Netlify sets this header); used to stop one person holding lots of seats */
export const clientIp = req => (req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64);

export const monthlyCap = () => Number(env('ONLINE_MONTHLY_CAP') || 190000);
export const holdMinutes = () => Number(env('SEAT_HOLD_MINUTES') || 15);
export const isSandbox = () => (env('PAYHERE_SANDBOX') ?? 'true') !== 'false';
