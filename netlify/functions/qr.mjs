// GET /.netlify/functions/qr?t=WV-XXXXXX-C4&s=<signature>  -> PNG of the ticket's QR (used in emails)
import { checkSig, verifyUrl, siteOrigin } from '../lib/tickets.mjs';
import { qrPng } from '../lib/qrpng.mjs';
export default async (req) => {
  const u = new URL(req.url), t = (u.searchParams.get('t') || '').toUpperCase(), s = u.searchParams.get('s') || '';
  if (!t || !checkSig(t, s)) return new Response('Not found', { status: 404 });
  return new Response(qrPng(verifyUrl(siteOrigin(req), t)), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
};
