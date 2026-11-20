/* =========================================================
   PAYMENT — PayHere popup (JavaScript SDK)
   ---------------------------------------------------------
   LIVE:  the server (netlify/functions/create-order) prices the
          seats and signs the payment with the merchant secret;
          this file just opens PayHere's secure popup with it.
          The booking only becomes "paid" when PayHere tells our
          server (netlify/functions/payhere-notify), never here.
   DEMO:  no server yet -> waits 2 seconds and pretends.
   Docs: https://support.payhere.lk/api-&-mobile-sdk/javascript-sdk
   ========================================================= */
window.Payment = (function () {
  const SDK = 'https://www.payhere.lk/lib/payhere.js';   // same script for sandbox & live
  let sdkLoading = null;

  function loadSDK() {
    if (window.payhere) return Promise.resolve();
    sdkLoading ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK; s.async = true;
      s.onload = () => (window.payhere ? resolve() : reject(new Error('PayHere did not load')));
      s.onerror = () => { sdkLoading = null; reject(new Error('Could not reach PayHere. Check your internet and try again.')); };
      document.head.appendChild(s);
    });
    return sdkLoading;
  }

  /** Opens PayHere. Resolves when the buyer finishes, rejects if they close it or it errors. */
  async function popup(payment) {
    await loadSDK();
    return new Promise((resolve, reject) => {
      payhere.onCompleted = orderId => resolve({ orderId });
      payhere.onDismissed = () => { const e = new Error('Payment window closed'); e.dismissed = true; reject(e); };
      payhere.onError = err => reject(new Error(String(err || 'Payment error')));
      payhere.startPayment({ ...payment, return_url: undefined, cancel_url: undefined });
    });
  }

  function demo() {
    return new Promise(resolve => setTimeout(() => resolve({ status: 'success', demo: true, paymentId: null }), 2200));
  }

  return {
    get demo() { return !(window.Backend && Backend.live); },
    get sandbox() { return !!(window.Backend && Backend.sandbox); },
    loadSDK,
    popup,
    pay: demo            // demo flow only
  };
})();
