/* =========================================================
   BACKEND SWITCH
   ---------------------------------------------------------
   • On Netlify with the keys set up  -> LIVE: real bookings in
     Supabase + PayHere (sandbox or live).
   • Opened from your laptop, or keys not set yet -> DEMO: the
     old in-browser bookings (js/db.js), nothing is charged.
   The rest of the site calls DB.* and doesn't need to care.
   ========================================================= */
window.Backend = (function () {
  const FN = '/.netlify/functions/';
  const KEYS = 'wv_my_keys';                   // { 'WV-XXXXXX': accessKey } for bookings made/found on this phone
  const state = { live: false, sandbox: true, cfg: null };
  // staff: a signed pass from the server (expires on its own); the PIN itself is never stored
  sessionStorage.removeItem('wv_staff_pin');
  let staffPass = sessionStorage.getItem('wv_staff_pass') || '';
  let staffCache = [];

  const keys = () => { try { return JSON.parse(localStorage.getItem(KEYS)) || {}; } catch { return {}; } };
  const remember = (ref, key) => { const k = keys(); k[ref] = key; try { localStorage.setItem(KEYS, JSON.stringify(k)); } catch {} };

  async function call(name, { method = 'GET', body, query = '', headers = {} } = {}) {
    const res = await fetch(FN + name + query, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error(data?.message || `Request failed (${res.status})`); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  // server booking -> the shape the site already uses
  const norm = b => b && ({
    ref: b.ref, status: b.status, channel: b.channel, amount: Number(b.amount), currency: b.currency,
    customer: b.customer || {}, paymentId: b.payment_id || null, paymentMethod: b.payment_method || null,
    createdAt: b.created_at, paidAt: b.paid_at, expiresAt: b.expires_at,
    emailSentAt: b.email_sent_at || null,
    slipAt: b.slip_uploaded_at || null, reviewNote: b.review_note || null, reviewedAt: b.reviewed_at || null,
    tickets: (b.tickets || []).map(t => ({ ...t, price: Number(t.price) }))
  });

  async function staff(body) {
    try { return await call('staff', { method: 'POST', body, headers: { 'x-staff-pass': staffPass } }); }
    catch (e) { if (e.status === 401) { staffPass = ''; sessionStorage.removeItem('wv_staff_pass'); } throw e; }
  }

  async function init() {
    // opened from the confirmation email: ?booking=WV-XXXXXX&key=...#tickets
    const q = new URLSearchParams(location.search);
    if (q.get('booking') && q.get('key')) {
      remember(q.get('booking').toUpperCase(), q.get('key'));
      history.replaceState(null, '', location.pathname + (location.hash || '#tickets'));
    }
    if (location.protocol === 'file:' || q.has('demo')) return state;
    try {
      const cfg = await call('config');
      state.cfg = cfg; state.live = !!cfg.ready; state.sandbox = !!cfg.sandbox;
    } catch { state.live = false; }
    if (state.live) installLiveDB();
    return state;
  }

  /* Swap the in-browser DB for the server one (same method names). */
  function installLiveDB() {
    Object.assign(window.DB, {
      async all() {                                   // MY bookings (this phone)
        const k = keys();
        const list = await Promise.all(Object.entries(k).map(([ref, key]) =>
          call('booking', { query: `?ref=${encodeURIComponent(ref)}&key=${encodeURIComponent(key)}` }).then(r => norm(r.booking)).catch(() => null)));
        return list.filter(Boolean);
      },
      async bookedSeatIds() { return (await call('seats')).taken || []; },
      async lookup(ref, phone) {
        try {
          const r = await call('booking', { method: 'POST', body: { ref, phone } });
          remember(r.booking.ref, r.accessKey);
          return norm(r.booking);
        } catch { return null; }
      },
      async staffAll() { staffCache = ((await staff({ action: 'list' })).bookings || []).map(norm); return staffCache; },
      async byRef(ref) {
        ref = String(ref).toUpperCase();
        return staffCache.find(b => b.ref === ref) || (await this.staffAll()).find(b => b.ref === ref) || null;
      },
      async checkIn(ticketId) {
        const r = await staff({ action: 'checkin', ticketId });
        const booking = norm(r.booking);
        return { result: r.result, booking, ticket: booking?.tickets.find(t => t.ticketId === r.ticketId) };
      },
      async undoCheckIn(ticketId) {
        const r = await staff({ action: 'undo', ticketId });
        return { booking: norm(r.booking) };
      },
      async cashSale(seats, customer) { const r = await staff({ action: 'cash', seats, customer }); return Object.assign(norm(r.booking), { emailResult: r.email }); },
      async resendEmail(ref) { return (await staff({ action: 'email', ref })).result; },
      async approveTransfer(ref, note) { const r = await staff({ action: 'approve', ref, note }); return Object.assign(norm(r.booking), { emailResult: r.email }); },
      async rejectTransfer(ref, note) { return norm((await staff({ action: 'reject', ref, note })).booking); },
      async slipLink(ref) { return staff({ action: 'slip', ref }); },
      async reset() { /* no reset on the real system */ }
    });
  }

  // photo -> JPEG no wider than 1600px (~200-500 KB); PDFs sent as they are (max 3 MB)
  async function slipData(file) {
    if (!file) throw new Error('Choose a photo or PDF of your slip.');
    const toB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
    if (file.type === 'application/pdf') {
      if (file.size > 3 * 1024 * 1024) throw new Error('That PDF is over 3 MB. Please send a screenshot instead.');
      return toB64(file);
    }
    if (!/^image\//.test(file.type)) throw new Error('Please choose a photo (JPG/PNG) or a PDF.');
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that photo. Try a screenshot instead.')); i.src = URL.createObjectURL(file); });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
    return toB64(blob);
  }

  return {
    init,
    get live() { return state.live; },
    get sandbox() { return state.sandbox; },
    get config() { return state.cfg; },
    get methods() { return state.cfg?.methods || []; },
    get bank() { return state.cfg?.bank || null; },
    get testMode() { return !!state.cfg?.testMode; },
    remember,
    norm,

    /** reserve seats + get the signed PayHere payment */
    async createOrder(customer, seats) {
      const r = await call('create-order', { method: 'POST', body: { customer, seats } });
      remember(r.booking.ref, r.accessKey);
      return { booking: norm(r.booking), accessKey: r.accessKey, payment: r.payment };
    },
    /** bank transfer: hold the seats, get the bank details + booking number */
    async createTransfer(customer, seats) {
      const r = await call('create-transfer', { method: 'POST', body: { customer, seats } });
      remember(r.booking.ref, r.accessKey);
      return { booking: norm(r.booking), bank: r.bank };
    },
    /** send the transfer slip (a photo is shrunk first so it uploads fast on mobile data) */
    async uploadSlip(ref, file) {
      const key = keys()[ref]; if (!key) throw new Error('This booking was made on another phone. Use "Find my tickets" first.');
      const data = await slipData(file);
      return norm((await call('upload-slip', { method: 'POST', body: { ref, key, data } })).booking);
    },
    async getBooking(ref) {
      const key = keys()[ref]; if (!key) return null;
      return norm((await call('booking', { query: `?ref=${encodeURIComponent(ref)}&key=${encodeURIComponent(key)}` })).booking);
    },
    async cancelPending(ref) {
      const key = keys()[ref]; if (!key) return;
      try { await call('booking', { method: 'POST', body: { action: 'cancel', ref, key } }); } catch {}
    },
    /** wait for PayHere's server confirmation to arrive (it can take a few seconds) */
    async waitForPaid(ref, { timeoutMs = 60000, everyMs = 2000 } = {}) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const b = await this.getBooking(ref).catch(() => null);
        if (b && b.status !== 'pending') return b;
        await new Promise(r => setTimeout(r, everyMs));
      }
      return this.getBooking(ref).catch(() => null);
    },
    /** -> true, or an error message */
    async staffLogin(pin) {
      try {
        const r = await call('staff', { method: 'POST', body: { action: 'login', pin } });
        staffPass = r.pass; sessionStorage.setItem('wv_staff_pass', staffPass); return true;
      } catch (e) { staffPass = ''; sessionStorage.removeItem('wv_staff_pass'); return e.message || 'Wrong staff PIN.'; }
    },
    staffLogout() { staffPass = ''; sessionStorage.removeItem('wv_staff_pass'); },
    get staffSignedIn() { return !!staffPass; }
  };
})();
