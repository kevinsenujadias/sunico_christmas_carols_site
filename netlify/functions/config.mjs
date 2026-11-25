// GET /.netlify/functions/config — tells the website what is switched on. Never returns a secret.
import { json, isConfigured, isSandbox, monthlyCap, holdMinutes, env, methods, payhereOn, bankDetails, bankHoldHours, testMode } from '../lib/http.mjs';
import { emailConfigured } from '../lib/email.mjs';
export default async () => {
  const ready = isConfigured();
  return json({
    ready,
    methods: ready ? methods() : [],
    sandbox: isSandbox(),
    testMode: testMode(),
    merchantId: payhereOn() ? env('PAYHERE_MERCHANT_ID') : null,   // the merchant ID is public; the secret never leaves the server
    bank: ready ? bankDetails() : null,                             // shown to every buyer anyway
    bankHoldHours: bankHoldHours(),
    monthlyCap: monthlyCap(),
    holdMinutes: holdMinutes(),
    email: emailConfigured(),
  });
};
