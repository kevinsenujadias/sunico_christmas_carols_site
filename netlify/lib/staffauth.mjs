// Staff sign-in.
//  • The PIN is checked once; the phone then gets a signed pass that expires after STAFF_SESSION_HOURS (default 12).
//    The PIN itself is not kept on the phone.
//  • Changing STAFF_PIN in Netlify instantly signs everyone out (the pass is tied to the PIN).
//  • Wrong PINs are counted per internet address: 8 wrong tries in 15 minutes locks that address for 15 minutes.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { env } from './http.mjs';
import { rpc } from './supabase.mjs';

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const pin = () => env('STAFF_PIN') || '';
const key = () => createHash('sha256').update('wv-staff|' + pin() + '|' + (env('TICKET_SECRET') || env('SUPABASE_SECRET_KEY') || '')).digest();
const hours = () => Math.min(24, Math.max(1, Number(env('STAFF_SESSION_HOURS') || 12)));

export const pinStrongEnough = () => /^\d{6,}$/.test(pin()) || pin().length >= 8;
export const pinMatches = given => pinStrongEnough() && same(given || '', pin());

export function makePass() {
  const exp = Date.now() + hours() * 3600e3;
  return `${exp}.${createHmac('sha256', key()).update('staff:' + exp).digest('base64url')}`;
}
export function passOk(pass) {
  const [exp, sig] = String(pass || '').split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return same(sig, createHmac('sha256', key()).update('staff:' + exp).digest('base64url'));
}

/** -> { ok:true } | { ok:false, locked:minutesLeft } */
export async function tryPin(given, ip) {
  const guard = await rpc('wv_pin_guard', { p_ip: ip || 'unknown' }).catch(() => null);
  if (guard && guard.locked) return { ok: false, locked: guard.minutes };
  if (pinMatches(given)) { await rpc('wv_pin_result', { p_ip: ip || 'unknown', p_ok: true }).catch(() => {}); return { ok: true }; }
  const r = await rpc('wv_pin_result', { p_ip: ip || 'unknown', p_ok: false }).catch(() => null);
  return { ok: false, locked: r && r.locked ? r.minutes : 0 };
}
