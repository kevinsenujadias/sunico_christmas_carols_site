// GET /.netlify/functions/verify?t=WV-XXXXXX-C4&s=<signature>
// Public: what the verification page shows when anyone scans a ticket's QR.
import { json } from '../lib/http.mjs';
import { checkSig } from '../lib/tickets.mjs';
import { rpc } from '../lib/supabase.mjs';

export default async (req) => {
  const u = new URL(req.url), t = (u.searchParams.get('t') || '').toUpperCase(), s = u.searchParams.get('s') || '';
  if (!t || !checkSig(t, s)) return json({ state: 'invalid', message: 'This QR code is not a genuine Winter Vespers ticket.' }, 404);
  let v;
  try { v = await rpc('wv_verify_ticket', { p_ticket_id: t }); }
  catch (e) { return json({ state: 'error', message: 'Could not check the ticket right now. Try again.' }, 503); }
  if (!v) return json({ state: 'invalid', message: 'This ticket no longer exists (the booking was cancelled).' }, 404);
  const state = ['paid', 'cash'].includes(v.status) ? (v.checkedInAt ? 'used' : 'valid')
    : ['pending', 'awaiting_transfer'].includes(v.status) ? 'pending' : v.status === 'paid_conflict' ? 'office' : 'void';
  return json({ state, ticket: v });
};
