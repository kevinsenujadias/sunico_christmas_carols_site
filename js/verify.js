/* Ticket verification page: opened by scanning a ticket's QR code. */
(function () {
  const $ = s => document.querySelector(s);
  const q = new URLSearchParams(location.search);
  const t = (q.get('t') || '').toUpperCase(), s = q.get('s') || '';
  const PIN_KEY = 'wv_door_pin';                  // remembered on door phones only
  const TIERS = { vip: 'VIP', gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
  const ICONS = {
    ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17h.01"/></svg>',
    bad: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>'
  };
  let toastT;
  const toast = m => { const el = $('#toast'); el.innerHTML = m; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3500); };
  const time = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' }) + ', ' + new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  function show(kind, title, sub, ticket) {
    const card = $('#card');
    card.className = 'vf-card ' + kind;
    $('.vf-status .ic').innerHTML = kind === 'valid' ? ICONS.ok : kind === 'used' ? ICONS.warn : ICONS.bad;
    $('#title').innerHTML = `${title}<small>${sub}</small>`;
    if (ticket) {
      $('#body').hidden = false;
      $('#row').textContent = (/^G[A-Z]/.test(ticket.row) ? 'Gallery ' : '') + ticket.row; $('#seat').textContent = ticket.num;
      $('#tier').textContent = (ticket.tier === 'vip' ? '♛ ' : '') + (TIERS[ticket.tier] || ticket.tier); $('#tier').className = 'tier-' + ticket.tier;
      $('#meta').innerHTML = `Ticket <b>${ticket.ticketId}</b><br>Booked by <b>${ticket.name}</b><br>Friday 18 December 2026 · from 4:30 PM · Namal Hall`;
    }
  }

  async function check() {
    if (location.protocol === 'file:') return show('bad', 'Not available offline', 'Open this from the live website.');
    if (q.has('demo') && t) {                               // made on a demo copy of the site
      const m = /-([A-Z]{1,2})(\d+)$/.exec(t);
      const info = m && window.HALL_PLAN && window.HALL_PLAN.seatInfo(m[1] + m[2]);
      show('used', 'DEMO TICKET', 'Made in demo mode, so it isn\'t a real booking. Live tickets are checked here.',
        info ? { row: info.row, num: info.num, tier: info.tier, ticketId: t, name: '(demo)' } : null);
      return;
    }
    if (!t || !s) return show('bad', 'Not a valid ticket', 'This link is incomplete.');
    let r, data;
    try { r = await fetch(`/.netlify/functions/verify?t=${encodeURIComponent(t)}&s=${encodeURIComponent(s)}`); data = await r.json(); }
    catch { return show('bad', 'Could not check', 'No connection to the booking system. Try again.'); }
    const k = data.ticket;
    switch (data.state) {
      case 'valid':   show('valid', 'VALID TICKET', 'Paid · not used yet', k); break;
      case 'used':    show('used', 'ALREADY USED', `Checked in at ${time(k.checkedInAt)}`, k); break;
      case 'pending': show('used', 'PAYMENT NOT CONFIRMED', 'Send them to the office', k); break;
      case 'office':  show('used', 'SEE THE OFFICE', 'Paid, but this seat needs checking', k); break;
      case 'void':    show('bad', 'NOT VALID', 'This booking was cancelled or not paid', k); break;
      default:        show('bad', 'NOT A GENUINE TICKET', data.message || 'This QR code is not recognised.');
    }
    setupStaff(data.state);
  }

  function setupStaff(state) {
    $('#staff').hidden = false;
    const pin = localStorage.getItem(PIN_KEY);
    $('#staffIn').hidden = !pin; $('#pinForm').hidden = !!pin;
    $('#checkInBtn').disabled = state !== 'valid';
    $('#checkInBtn').textContent = state === 'valid' ? 'Check in this ticket' : state === 'used' ? 'Already checked in' : 'Cannot check in';
  }

  async function staff(body, pin = localStorage.getItem(PIN_KEY)) {
    const r = await fetch('/.netlify/functions/staff', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-staff-pin': pin || '' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.message || 'Failed'); e.status = r.status; throw e; }
    return d;
  }

  $('#pinForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pin = $('#pin').value;
    try { await staff({ action: 'login' }, pin); localStorage.setItem(PIN_KEY, pin); $('#pin').value = ''; check(); }
    catch { toast('Wrong staff PIN.'); }
  });
  $('#checkInBtn').addEventListener('click', async () => {
    try {
      const r = await staff({ action: 'checkin', ticketId: t });
      if (r.result === 'ok') { toast('Checked in ✓ Let them in.'); try { navigator.vibrate && navigator.vibrate(80); } catch {} }
      else if (r.result === 'already') toast('Already used. Ask for ID.');
      check();
    } catch (e) {
      if (e.status === 401) { localStorage.removeItem(PIN_KEY); toast('Please sign in again.'); check(); }
      else toast('Check-in failed. Check the connection.');
    }
  });
  $('#signOut').addEventListener('click', () => { localStorage.removeItem(PIN_KEY); check(); });

  check();
})();
