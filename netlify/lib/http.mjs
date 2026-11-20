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

export const isConfigured = () =>
  !!(env('SUPABASE_URL') && env('SUPABASE_SECRET_KEY') && env('PAYHERE_MERCHANT_ID') && env('PAYHERE_MERCHANT_SECRET'));

export const monthlyCap = () => Number(env('ONLINE_MONTHLY_CAP') || 190000);
export const holdMinutes = () => Number(env('SEAT_HOLD_MINUTES') || 15);
export const isSandbox = () => (env('PAYHERE_SANDBOX') ?? 'true') !== 'false';
