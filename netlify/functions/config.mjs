// GET /.netlify/functions/config — tells the website whether real payments are switched on.
import { json, isConfigured, isSandbox, monthlyCap, holdMinutes, env } from '../lib/http.mjs';
import { emailConfigured } from '../lib/email.mjs';
export default async () => json({
  ready: isConfigured(),
  sandbox: isSandbox(),
  merchantId: isConfigured() ? env('PAYHERE_MERCHANT_ID') : null,   // the merchant ID is public; the secret never leaves the server
  monthlyCap: monthlyCap(),
  holdMinutes: holdMinutes(),
  email: emailConfigured(),
});
