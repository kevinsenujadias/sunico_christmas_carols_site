/* =========================================================
   PAYMENT — PayHere placeholder
   ---------------------------------------------------------
   Right now DEMO_MODE = true, so "Pay" just waits 2 seconds
   and reports success. Nothing is charged.

   To go live with PayHere later:
   1. Add PayHere's script to index.html, above js/payment.js:
        <script src="https://www.payhere.lk/lib/payhere.js"></script>
   2. Fill in MERCHANT_ID and set DEMO_MODE = false.
   3. The `hash` MUST be generated on a server (it uses your
      merchant secret, which must never be in the browser).
      Point HASH_ENDPOINT at that server route. It should return
      { hash: "..." } for the order_id + amount + currency.
   4. Set notify_url to a server route that receives PayHere's
      payment notification and marks the seats as SOLD for real.
   ========================================================= */
window.Payment = (function () {
  const DEMO_MODE = true;
  const SANDBOX = true;                       // switch to false for real payments
  const MERCHANT_ID = 'YOUR_MERCHANT_ID';
  const HASH_ENDPOINT = '/api/payhere/hash';  // your server
  const NOTIFY_URL = 'https://your-domain.lk/api/payhere/notify';

  function demo(order) {
    return new Promise(resolve => setTimeout(() => resolve({ status: 'success', demo: true, paymentId: null }), 2200));
  }

  async function live(order) {
    if (typeof payhere === 'undefined') throw new Error('PayHere script not loaded');
    const res = await fetch(HASH_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order.ref, amount: order.amount.toFixed(2), currency: 'LKR' })
    });
    const { hash } = await res.json();

    return new Promise((resolve, reject) => {
      payhere.onCompleted = id => resolve({ status: 'success', paymentId: id });
      payhere.onDismissed = () => reject(new Error('Payment was closed before finishing'));
      payhere.onError = err => reject(new Error(err));
      payhere.startPayment({
        sandbox: SANDBOX,
        merchant_id: MERCHANT_ID,
        return_url: undefined,             // popup mode
        cancel_url: undefined,
        notify_url: NOTIFY_URL,
        order_id: order.ref,
        items: `Winter Vespers 2026 — ${order.tickets.length} seat(s): ${order.tickets.map(t => t.seat).join(', ')}`,
        amount: order.amount.toFixed(2),
        currency: 'LKR',
        hash,
        first_name: order.customer.first,
        last_name: order.customer.last,
        email: order.customer.email,
        phone: order.customer.phone,
        address: 'N/A',
        city: 'Colombo',
        country: 'Sri Lanka',
        custom_1: order.tickets.map(t => t.seat).join(',')
      });
    });
  }

  return {
    demo: DEMO_MODE,
    pay: order => (DEMO_MODE ? demo(order) : live(order))
  };
})();
