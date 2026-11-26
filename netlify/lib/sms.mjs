// SMS to parents through a Sri Lankan SMS gateway. Works with either:
//   Text.lk   : TEXTLK_API_KEY                    (+ SMS_SENDER_ID once approved; until then "TextLKDemo")
//   Notify.lk : NOTIFY_USER_ID + NOTIFY_API_KEY   (+ NOTIFY_SENDER_ID; until then "NotifyDEMO")
// If both are set, Text.lk is used. Every text carries a short private link to the buyer's own booking.
import { env } from './http.mjs';

const provider = () => env('TEXTLK_API_KEY') ? 'textlk' : (env('NOTIFY_USER_ID') && env('NOTIFY_API_KEY')) ? 'notify' : null;
export const smsConfigured = () => !!provider();

/** 0771234567 / 771234567 / +94 77 123 4567 -> 94771234567 (Sri Lankan mobiles only), else null */
export function lkMobile(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0094')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('07')) d = '94' + d.slice(1);
  else if (d.length === 9 && d.startsWith('7')) d = '94' + d;
  return /^947\d{8}$/.test(d) ? d : null;
}

export const bookingLink = (origin, ref, key) => `${origin}/b/${encodeURIComponent(ref)}/${encodeURIComponent(key)}`;

const TEXTS = {
  slip:     (b, link) => `Winter Vespers: slip received. We're verifying it & will send your tickets soon: ${link}`,
  approved: (b, link) => `SUNICO Winter Vespers: Payment approved! Your ${b.tickets.length} ticket${b.tickets.length > 1 ? 's' : ''} for 18 Dec, Namal Hall: ${link}`,
  cash:     (b, link) => `SUNICO Winter Vespers: Thank you! Your ${b.tickets.length} ticket${b.tickets.length > 1 ? 's' : ''} for 18 Dec, Namal Hall: ${link}`,
  rejected: (b) => `SUNICO Winter Vespers: Booking ${b.ref} was not approved (${String(b.review_note || 'transfer not received').slice(0, 45)}). Seats released. Help: sunico2023@gmail.com`,
};

/** kind: 'slip' | 'approved' | 'cash' | 'rejected'. b needs ref, access_key, customer.phone, tickets. Never throws. */
export async function sendSms(kind, b, origin) {
  if (!smsConfigured()) return 'not-configured';
  const to = lkMobile(b.customer?.phone);
  if (!to) return 'no-mobile';
  const message = TEXTS[kind](b, bookingLink(origin, b.ref, b.access_key));
  try {
    let res, ok;
    if (provider() === 'textlk') {
      res = await fetch('https://app.text.lk/api/v3/sms/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env('TEXTLK_API_KEY')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ recipient: to, sender_id: env('SMS_SENDER_ID') || 'TextLKDemo', type: 'plain', message }),
      });
    } else {
      res = await fetch('https://app.notify.lk/api/v1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ user_id: env('NOTIFY_USER_ID'), api_key: env('NOTIFY_API_KEY'),
          sender_id: env('NOTIFY_SENDER_ID') || 'NotifyDEMO', to, message }),
      });
    }
    const d = await res.json().catch(() => ({}));
    ok = res.ok && d.status === 'success';
    if (!ok) { console.error('[sms]', provider(), res.status, JSON.stringify(d).slice(0, 200)); return 'failed'; }
    return 'sent';
  } catch (e) { console.error('[sms]', e.message); return 'failed'; }
}
