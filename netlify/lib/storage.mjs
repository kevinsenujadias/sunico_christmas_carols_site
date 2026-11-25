// Payment slips live in a PRIVATE Supabase Storage bucket called "slips".
// Only the server (secret key) can put files in or make a short-lived link for staff to view one.
const env = k => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];
const BUCKET = 'slips';

function base() {
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SECRET_KEY');
  if (!url || !key) throw new Error('NOT_CONFIGURED');
  const headers = { apikey: key };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;   // older "service_role" keys
  return { url: url.replace(/\/$/, '') + '/storage/v1', headers };
}

/** check the first bytes really are a picture or PDF (not just a file that says it is) */
export function sniff(buf) {
  const h = buf.subarray(0, 12);
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (h[0] === 0x89 && h.toString('latin1', 1, 4) === 'PNG') return { type: 'image/png', ext: 'png' };
  if (h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  if (h.toString('latin1', 0, 5) === '%PDF-') return { type: 'application/pdf', ext: 'pdf' };
  return null;
}

export async function putSlip(path, buf, type) {
  const { url, headers } = base();
  const res = await fetch(`${url}/object/${BUCKET}/${path}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': type, 'x-upsert': 'true', 'cache-control': 'no-store' }, body: buf,
  });
  if (!res.ok) throw new Error(`STORAGE_${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** a link that works for 10 minutes, so a slip can never be opened by someone who just guesses the address */
export async function slipLink(path, seconds = 600) {
  const { url, headers } = base();
  const res = await fetch(`${url}/object/sign/${BUCKET}/${path}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: seconds }),
  });
  if (!res.ok) throw new Error(`STORAGE_${res.status}`);
  const d = await res.json();
  const signed = d.signedURL || d.signedUrl;
  return signed.startsWith('http') ? signed : url + signed;
}
