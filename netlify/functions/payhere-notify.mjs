// POST /.netlify/functions/payhere-notify — PayHere calls this (server to server) after every payment.
// This is the ONLY place a booking becomes "paid".
import { readBody, env } from '../lib/http.mjs';
import { verifyNotify } from '../lib/payhere.mjs';
import { rpc } from '../lib/supabase.mjs';
import { sendConfirmation } from '../lib/email.mjs';
import { siteOrigin } from '../lib/tickets.mjs';

const text = (s, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'text/plain' } });

export default async (req) => {
  if (req.method !== 'POST') return text('Method not allowed', 405);
  const f = await readBody(req).catch(() => ({}));

  // 1. Is this really from PayHere? (signature made with our secret)
  if (!verifyNotify(f, { merchantId: env('PAYHERE_MERCHANT_ID'), secret: env('PAYHERE_MERCHANT_SECRET') })) {
    console.warn('[notify] REJECTED bad signature for order', f.order_id);
    return text('Invalid signature', 400);
  }

  // 2. Apply it (the database also checks the amount & currency match the booking exactly)
  try {
    const b = await rpc('wv_apply_payment', {
      p_ref: f.order_id, p_status_code: Number(f.status_code), p_amount: Number(f.payhere_amount),
      p_currency: f.payhere_currency, p_payment_id: f.payment_id || null, p_method: f.method || null,
      p_message: f.status_message || null,
    });
    console.log('[notify]', f.order_id, 'status', f.status_code, '->', b?.status, 'payment', f.payment_id);
    // 3. Email the tickets (only once, even if PayHere notifies twice). A failed email never blocks the booking.
    if (b?.status === 'paid') {
      const r = await sendConfirmation(f.order_id, siteOrigin(req)).catch(e => (console.error('[email]', e.message), 'failed'));
      console.log('[email]', f.order_id, r);
    }
    return text('OK');
  } catch (e) {
    console.error('[notify] FAILED', f.order_id, e.message);
    // amount tampering / unknown booking: tell PayHere we did not accept it
    return text(e.message, e.message === 'AMOUNT_MISMATCH' || e.message === 'NO_BOOKING' ? 400 : 500);
  }
};
