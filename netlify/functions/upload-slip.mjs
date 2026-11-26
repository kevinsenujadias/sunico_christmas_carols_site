// POST /.netlify/functions/upload-slip  { ref, key, data:<base64> }
// The buyer's photo/PDF of their bank transfer. It is only a HINT for staff: a booking is approved
// only when the money is actually seen in the school's bank account.
import { json, fail, readBody } from '../lib/http.mjs';
import { rpc } from '../lib/supabase.mjs';
import { sniff, putSlip } from '../lib/storage.mjs';
import { sendSlipReceived } from '../lib/email.mjs';
import { sendSms } from '../lib/sms.mjs';
import { siteOrigin } from '../lib/tickets.mjs';

const MAX_BYTES = 3 * 1024 * 1024;   // 3 MB (the website shrinks photos before sending)

export default async (req) => {
  if (req.method !== 'POST') return fail('METHOD', 'Use POST', 405);
  let body; try { body = await readBody(req); } catch { return fail('BAD_JSON', 'Bad request'); }
  const ref = String(body.ref || '').toUpperCase().slice(0, 20), key = String(body.key || '').slice(0, 64);
  if (!/^WV-[A-Z0-9]{6}$/.test(ref) || !key) return fail('BAD_INPUT', 'Missing booking details.');
  const data = String(body.data || '');
  if (data.length > MAX_BYTES * 1.4) return fail('TOO_BIG', 'That file is too big. Please send a photo or PDF under 3 MB.', 413);
  const buf = Buffer.from(data, 'base64');
  if (!buf.length || buf.length > MAX_BYTES) return fail('TOO_BIG', 'That file is too big. Please send a photo or PDF under 3 MB.', 413);
  const kind = sniff(buf);
  if (!kind) return fail('BAD_FILE', 'Please upload a photo (JPG/PNG) or a PDF of your transfer slip.', 415);

  try {
    const b = await rpc('wv_get_booking', { p_ref: ref, p_access_key: key });
    if (!b) return fail('NOT_FOUND', 'Booking not found.', 404);
    if (b.status !== 'awaiting_transfer') return fail('NOT_WAITING', b.status === 'paid' ? 'This booking is already paid.' : 'This booking is no longer waiting for a transfer.', 409);
    const path = `${ref}/${Date.now()}.${kind.ext}`;
    await putSlip(path, buf, kind.type);
    const booking = await rpc('wv_attach_slip', { p_ref: ref, p_access_key: key, p_path: path });
    // first slip only: email "we got it, we're verifying" (a failed email never blocks the upload)
    let email = 'skipped', sms = 'skipped';
    if (!b.slip_uploaded_at) {
      const full = { ...booking, access_key: key }, origin = siteOrigin(req);
      [email, sms] = await Promise.all([
        sendSlipReceived(full, origin).catch(e => (console.error('[slip-email]', e.message), 'failed')),
        sendSms('slip', full, origin),
      ]);
    }
    return json({ booking, email, sms });
  } catch (e) {
    console.error('[upload-slip]', e.message);
    if (e.message.startsWith('NOT_WAITING')) return fail('NOT_WAITING', 'This booking is no longer waiting for a transfer.', 409);
    return fail('UPLOAD', 'Could not upload the slip. Please try again.', 502);
  }
};
