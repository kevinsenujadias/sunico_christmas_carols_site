// Confirmation email with the tickets, sent through Brevo (free: 300 emails/day).
// Needs BREVO_API_KEY + EMAIL_FROM (a sender address verified in Brevo).
import { env } from './http.mjs';
import { qrImageUrl, verifyUrl } from './tickets.mjs';
import { rpc } from './supabase.mjs';
import { TIERS } from './hall.mjs';

export const emailConfigured = () => !!(env('BREVO_API_KEY') && env('EMAIL_FROM'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rs = n => 'Rs. ' + Number(n).toLocaleString('en-US');

export function buildEmail(b, origin) {
  const c = b.customer || {}, n = b.tickets.length;
  const link = `${origin}/?booking=${encodeURIComponent(b.ref)}&key=${encodeURIComponent(b.access_key)}#tickets`;
  const rows = b.tickets.map(t => `
    <tr><td style="padding:14px 0;border-top:1px solid #eadfcd">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="150" valign="top"><a href="${verifyUrl(origin, t.ticketId)}"><img src="${qrImageUrl(origin, t.ticketId)}" width="140" height="140" alt="QR code for seat ${esc(t.seat)}" style="display:block;border:1px solid #eadfcd;border-radius:8px"></a></td>
        <td valign="top" style="padding-left:16px;font-family:Arial,Helvetica,sans-serif;color:#2b1d12">
          <div style="font-size:12px;letter-spacing:2px;color:#9a7b4f;text-transform:uppercase">${esc(TIERS[t.tier]?.label || t.tier)} · ${rs(t.price)}</div>
          <div style="font-family:Georgia,serif;font-size:30px;font-weight:bold;margin:4px 0">Row ${esc(t.row)} · Seat ${esc(t.num)}</div>
          <div style="font-size:13px;color:#6b5a48">Ticket ${esc(t.ticketId)}</div>
          <div style="font-size:12px;color:#8a7a68;margin-top:8px">Show this QR code at the door. It admits one person, once.</div>
        </td></tr></table>
    </td></tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f4efe6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe6;padding:24px 0"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fffaf2;border-radius:14px;overflow:hidden">
      <tr><td><img src="${origin}/assets/img/ticket-face.jpg" width="600" alt="Winter Vespers 2026 · Hark! The Herald Angels are Singing" style="display:block;width:100%;height:auto"></td></tr>
      <tr><td style="padding:26px 28px 6px;font-family:Arial,Helvetica,sans-serif;color:#2b1d12">
        <div style="font-family:Georgia,serif;font-size:26px">You're booked, ${esc(c.first)}!</div>
        <p style="font-size:15px;line-height:1.6;color:#5a4a3a;margin:10px 0 0">Here ${n > 1 ? `are your <b>${n} tickets</b>` : 'is your <b>ticket</b>'} for <b>Winter Vespers 2026</b>, SUNICO's evening of Christmas carols.</p>
      </td></tr>
      <tr><td style="padding:16px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#7c0a1c;border-radius:10px"><tr>
          <td style="padding:14px 18px;font-family:Arial,Helvetica,sans-serif;color:#f6dc93;font-size:12px;letter-spacing:2px">BOOKING NUMBER</td>
          <td align="right" style="padding:14px 18px;font-family:'Courier New',monospace;color:#fff;font-size:22px;font-weight:bold;letter-spacing:2px">${esc(b.ref)}</td>
        </tr></table>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#5a4a3a;margin-top:12px;line-height:1.7">
          📅 <b>Friday, 18 December 2026</b> · from <b>4:30 PM</b><br>📍 <b>Namal Hall</b><br>💳 Total paid: <b>${rs(b.amount)}</b>${b.payment_id ? ` · PayHere ref ${esc(b.payment_id)}` : b.status === 'cash' ? ' · paid at the school office' : ''}
        </div>
      </td></tr>
      <tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
      <tr><td align="center" style="padding:18px 28px 8px">
        <a href="${link}" style="display:inline-block;background:#e7bd5a;color:#2a1a00;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:15px;text-decoration:none;padding:13px 26px;border-radius:30px">View your tickets online</a>
      </td></tr>
      <tr><td style="padding:14px 28px 26px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a7a68;line-height:1.6">
        Keep this email: it's your digital copy. You can also find your tickets on the website with your booking number and phone number.<br>
        Questions? Just reply to this email or contact the SUNICO office.
      </td></tr>
    </table>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#a89880;padding:14px">SUNICO · Winter Vespers 2026 · Namal Hall</div>
  </td></tr></table></body></html>`;
  const text = [`You're booked, ${c.first}!`, '', `Booking number: ${b.ref}`, 'Winter Vespers 2026 · Friday 18 December 2026 · from 4:30 PM · Namal Hall', `Total: ${rs(b.amount)}`, '',
    ...b.tickets.map(t => `Row ${t.row} Seat ${t.num} (${TIERS[t.tier]?.label || t.tier}) · ticket ${t.ticketId} · QR: ${verifyUrl(origin, t.ticketId)}`), '',
    `View your tickets: ${link}`].join('\n');
  return { subject: `Your Winter Vespers tickets · ${b.ref} · ${n} seat${n > 1 ? 's' : ''}`, html, text };
}

/** Sends the confirmation once (unless force). Returns 'sent' | 'already' | 'no-email' | 'not-configured' | 'not-paid'. */
export async function sendConfirmation(ref, origin, { force = false } = {}) {
  if (!emailConfigured()) return 'not-configured';
  const b = await rpc('wv_email_payload', { p_ref: ref });
  if (!b) throw new Error('NO_BOOKING');
  if (!['paid', 'cash'].includes(b.status)) return 'not-paid';
  if (b.email_sent_at && !force) return 'already';
  const to = b.customer?.email;
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return 'no-email';
  const { subject, html, text } = buildEmail(b, origin);
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env('BREVO_API_KEY'), 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: env('EMAIL_FROM_NAME') || 'SUNICO Winter Vespers', email: env('EMAIL_FROM') },
      to: [{ email: to, name: `${b.customer.first || ''} ${b.customer.last || ''}`.trim() }],
      ...(env('EMAIL_REPLY_TO') ? { replyTo: { email: env('EMAIL_REPLY_TO') } } : {}),
      subject, htmlContent: html, textContent: text, tags: ['winter-vespers', 'tickets'],
    }),
  });
  if (!res.ok) throw new Error(`EMAIL_FAILED ${res.status}: ${(await res.text()).slice(0, 200)}`);
  await rpc('wv_mark_email_sent', { p_ref: ref });
  return 'sent';
}
