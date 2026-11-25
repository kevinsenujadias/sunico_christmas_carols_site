// GET /.netlify/functions/booking?ref=WV-XXXXXX&key=...   — the buyer's own phone loading its tickets
// POST { ref, phone }                                       — "find my tickets" on another phone
// POST { action:'cancel', ref, key }                         — buyer closed the payment popup
import { json, fail, readBody } from '../lib/http.mjs';
import { rpc } from '../lib/supabase.mjs';
import { addVerify, siteOrigin } from '../lib/tickets.mjs';
export default async (req) => {
  try {
    if (req.method === 'GET') {
      const u = new URL(req.url);
      const b = await rpc('wv_get_booking', { p_ref: u.searchParams.get('ref') || '', p_access_key: u.searchParams.get('key') || '' });
      return b ? json({ booking: addVerify(b, siteOrigin(req)) }) : fail('NOT_FOUND', 'Booking not found', 404);
    }
    const body = await readBody(req);
    if (body.action === 'cancel') {                       // buyer closed the PayHere popup
      const b = await rpc('wv_cancel_pending', { p_ref: String(body.ref || ''), p_access_key: String(body.key || '') });
      return json({ booking: b });
    }
    const { ref, phone } = body;
    if (!ref || String(phone || '').replace(/\D/g, '').length < 7) return fail('BAD_INPUT', 'Enter your booking number and phone.');
    const b = await rpc('wv_lookup_booking', { p_ref: String(ref), p_phone_tail: String(phone) });
    if (!b) return fail('NOT_FOUND', "We couldn't find a booking with that number and phone.", 404);
    const { access_key, ...booking } = b;
    return json({ booking: addVerify(booking, siteOrigin(req)), accessKey: access_key });
  } catch (e) { return fail('DB', e.message, e.status || 500); }
};
