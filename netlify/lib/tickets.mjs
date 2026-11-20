// Signed QR links. The QR on each ticket opens:
//   https://<site>/v?t=WV-7K3QX9-C4&s=<signature>   (/v shows verify.html, see netlify.toml)
// The signature is made with TICKET_SECRET, so nobody can invent a working QR for a seat.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { env } from './http.mjs';

function secret() {
  const s = env('TICKET_SECRET');
  if (s) return s;
  // fallback so things still work before TICKET_SECRET is set (set it! see SETUP-GUIDE.md)
  return createHash('sha256').update('wv-ticket:' + (env('SUPABASE_SECRET_KEY') || 'dev')).digest('hex');
}

export const signTicket = id => createHmac('sha256', secret()).update(String(id).toUpperCase()).digest('base64url').slice(0, 12);

export function checkSig(id, sig) {
  const a = Buffer.from(signTicket(id)), b = Buffer.from(String(sig || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const siteOrigin = req => (env('SITE_URL') || (req ? new URL(req.url).origin : '')).replace(/\/$/, '');

export const verifyUrl = (origin, id) => `${origin}/v?t=${encodeURIComponent(id)}&s=${signTicket(id)}`;
export const qrImageUrl = (origin, id) => `${origin}/.netlify/functions/qr?t=${encodeURIComponent(id)}&s=${signTicket(id)}`;

/** add the signed QR link to every ticket of a booking (only for people allowed to see the booking) */
export function addVerify(booking, origin) {
  if (!booking || !Array.isArray(booking.tickets)) return booking;
  return { ...booking, tickets: booking.tickets.map(t => ({ ...t, verifyUrl: verifyUrl(origin, t.ticketId) })) };
}
