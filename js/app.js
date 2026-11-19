/* =========================================================
   Winter Vespers 2026 — ticketing app
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- CONFIG (edit here) ---------------- */
  const EVENT = {
    name: 'Winter Vespers',
    year: 2026,
    venue: 'Namal Hall',
    dateISO: '2026-12-18T18:30:00+05:30',
    day: 'Friday', dayNum: 18, month: 'December', time: '6:30 PM'
  };
  const TIERS = {
    gold:   { label: 'Gold',   price: 1500, coin: 'assets/img/coin-gold.png' },
    silver: { label: 'Silver', price: 1000, coin: 'assets/img/coin-silver.png' },
    bronze: { label: 'Bronze', price: 750,  coin: 'assets/img/coin-bronze.png' }
  };
  const MAX_SEATS = 10;
  const HOLD_SECONDS = 10 * 60;
  const DEMO_TAKEN_RATIO = 0.14;   // pretend some seats are already sold

  // Namal Hall plan: 300 seats. blocks = seats in [left, centre, right] sections.
  const ROWS = [
    ...'ABCD'.split('').map(r => ({ row: r, tier: 'gold',   zone: 'floor',   blocks: [6, 8, 6] })),
    ...'EFGHIJ'.split('').map(r => ({ row: r, tier: 'silver', zone: 'floor',   blocks: [6, 10, 6] })),
    ...'KLMN'.split('').map(r => ({ row: r, tier: 'bronze', zone: 'gallery', blocks: [6, 10, 6] }))
  ];

  /* ---------------- helpers ---------------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const rs = n => 'Rs. ' + n.toLocaleString('en-US');
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  function seeded(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }
  function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.innerHTML = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200);
  }

  /* ---------------- state ---------------- */
  const seats = new Map();                 // id -> seat object
  const picked = new Map();                // id -> seat
  let orders = store.get('wv_orders', []);
  let holdEnd = null, holdTimer = null;
  let justPaidOrderId = null;

  /* =========================================================
     HALL PLAN (SVG)
     ========================================================= */
  const hall = $('#hall');
  const CX = 500, CY = -600;               // centre of the curved rows (behind the stage)
  const FLOOR_R0 = 790, ROW_GAP = 36, GALLERY_GAP = 110;
  const SEAT_STEP = 27, AISLE = 1.9;

  function buildHall() {
    hall.innerHTML = '';
    const defs = svgEl('defs', {}, hall);
    defs.innerHTML = `
      <radialGradient id="stageGlow" cx="50%" cy="0%" r="70%">
        <stop offset="0%" stop-color="#f6dc93" stop-opacity=".55"/>
        <stop offset="100%" stop-color="#f6dc93" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="stageFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7c0a1c"/><stop offset="100%" stop-color="#3a0610"/>
      </linearGradient>
      <linearGradient id="screenFill" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#fff" stop-opacity="0"/><stop offset="20%" stop-color="#fff" stop-opacity=".95"/>
        <stop offset="80%" stop-color="#fff" stop-opacity=".95"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <filter id="blur8"><feGaussianBlur stdDeviation="8"/></filter>`;

    // Hall walls
    svgEl('path', {
      d: 'M60 30 Q60 10 80 10 L920 10 Q940 10 940 30 L975 560 L975 845 Q975 852 968 852 L32 852 Q25 852 25 845 L25 560 Z',
      fill: 'rgba(255,255,255,.015)', stroke: 'rgba(255,255,255,.08)', 'stroke-width': 1.5
    }, hall);

    // Screen + stage
    svgEl('ellipse', { cx: 500, cy: 40, rx: 330, ry: 110, fill: 'url(#stageGlow)', class: 'stage-glow' }, hall);
    svgEl('path', { d: 'M300 24 Q500 14 700 24', stroke: '#fff', 'stroke-width': 8, filter: 'url(#blur8)', opacity: .6 }, hall);
    svgEl('path', { d: 'M300 24 Q500 14 700 24', stroke: 'url(#screenFill)', 'stroke-width': 4 }, hall);
    const sl = svgEl('text', { x: 500, y: 42, 'text-anchor': 'middle', class: 'stage-sub' }, hall); sl.textContent = 'SCREEN';
    svgEl('path', {
      d: 'M235 52 L765 52 L735 128 Q500 158 265 128 Z',
      fill: 'url(#stageFill)', stroke: 'rgba(246,220,147,.55)', 'stroke-width': 1.5
    }, hall);
    const st = svgEl('text', { x: 505, y: 104, 'text-anchor': 'middle', class: 'stage-label' }, hall); st.textContent = 'STAGE';

    // Gallery band
    const gR1 = FLOOR_R0 + 9 * ROW_GAP + GALLERY_GAP - 34, gR2 = gR1 + 4 * ROW_GAP + 32, ga = 0.3;
    const p = (R, a) => `${(CX + R * Math.sin(a)).toFixed(1)} ${(CY + R * Math.cos(a)).toFixed(1)}`;
    svgEl('path', {
      d: `M${p(gR1, -ga)} A${gR1} ${gR1} 0 0 0 ${p(gR1, ga)} L${p(gR2, ga)} A${gR2} ${gR2} 0 0 1 ${p(gR2, -ga)} Z`,
      fill: 'rgba(196,127,78,.05)', stroke: 'rgba(196,127,78,.25)', 'stroke-width': 1
    }, hall);
    svgEl('path', { d: `M${p(gR1, -ga)} A${gR1} ${gR1} 0 0 0 ${p(gR1, ga)}`, stroke: 'rgba(196,127,78,.6)', 'stroke-width': 3, 'stroke-dasharray': '2 6' }, hall);
    const gl = svgEl('text', { x: 500, y: CY + gR1 - 12, 'text-anchor': 'middle', class: 'zone-label' }, hall);
    gl.textContent = 'GALLERY · UPPER LEVEL';

    // Entrances
    [[40, 552, 'start'], [960, 552, 'end']].forEach(([x, y, a]) => {
      const t = svgEl('text', { x, y, 'text-anchor': a, class: 'zone-label', style: 'font-size:10px' }, hall);
      t.textContent = 'ENTRANCE';
      svgEl('path', { d: a === 'start' ? `M27 530 L27 570` : `M973 530 L973 570`, stroke: 'rgba(231,189,90,.7)', 'stroke-width': 4 }, hall);
    });

    // Seats
    const rand = seeded(20261218);
    const booked = new Set(orders.flatMap(o => o.seats.map(s => s.id)));
    const gSeats = svgEl('g', { id: 'seats' }, hall);
    let floorIdx = 0, galIdx = 0;
    const tierSpans = {};

    ROWS.forEach(rowDef => {
      const R = rowDef.zone === 'floor'
        ? FLOOR_R0 + (floorIdx++) * ROW_GAP
        : FLOOR_R0 + 9 * ROW_GAP + GALLERY_GAP + (galIdx++) * ROW_GAP;

      // unit positions along the arc, with aisles between blocks
      const units = []; let u = 0;
      rowDef.blocks.forEach((n, b) => {
        for (let i = 0; i < n; i++) { units.push({ u, block: b }); u++; }
        u += AISLE;           // aisle gap
      });
      const last = units[units.length - 1].u, mid = last / 2;

      units.forEach((pt, i) => {
        const theta = (pt.u - mid) * SEAT_STEP / R;
        const x = CX + R * Math.sin(theta), y = CY + R * Math.cos(theta);
        const num = i + 1;
        const id = rowDef.row + num;
        const taken = booked.has(id) || rand() < DEMO_TAKEN_RATIO;
        const seat = { id, row: rowDef.row, num, tier: rowDef.tier, block: pt.block, u: pt.u, mid, taken, x, y, el: null };
        const g = svgEl('g', {
          class: `seat ${seat.tier}${taken ? ' taken' : ''}`,
          transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(-theta * 180 / Math.PI).toFixed(2)})`,
          'data-id': id, tabindex: taken ? -1 : 0, role: 'button',
          'aria-label': `Row ${seat.row} seat ${num}, ${TIERS[seat.tier].label}, ${rs(TIERS[seat.tier].price)}${taken ? ', taken' : ''}`
        }, gSeats);
        // inner group so CSS scale doesn't fight the transform attribute
        const inner = svgEl('g', { class: 'seat-in' }, g);
        svgEl('rect', { x: -10, y: 5, width: 20, height: 5.5, rx: 2, class: 's-back' }, inner);
        svgEl('rect', { x: -10, y: -9, width: 20, height: 16, rx: 4.5, class: 's-body' }, inner);
        svgEl('path', { d: 'M-4.5 -5.5 L4.5 3.5 M4.5 -5.5 L-4.5 3.5', class: 's-x' }, inner);
        svgEl('path', { d: 'M-5 -1.5 L-1.5 2 L5 -5', class: 's-check' }, inner);
        seat.el = g;
        seats.set(id, seat);

        if (i === 0 || i === units.length - 1) {
          const off = (i === 0 ? -1.6 : 1.6) * SEAT_STEP / R;
          const lx = CX + R * Math.sin(theta + off), ly = CY + R * Math.cos(theta + off);
          const t = svgEl('text', { x: lx.toFixed(1), y: (ly + 4).toFixed(1), 'text-anchor': 'middle', class: 'row-lbl' }, hall);
          t.textContent = rowDef.row;
        }
      });
      const ts = tierSpans[rowDef.tier] || (tierSpans[rowDef.tier] = { min: Infinity, max: -Infinity });
      ts.min = Math.min(ts.min, CY + R); ts.max = Math.max(ts.max, CY + R);
    });
    hall.appendChild(gSeats);   // seats on top of labels

    // tier brackets on the left
    const colors = { gold: '#e7bd5a', silver: '#cdd6e2', bronze: '#c47f4e' };
    Object.entries(tierSpans).forEach(([tier, s]) => {
      svgEl('path', { d: `M52 ${s.min - 8} L46 ${s.min - 8} L46 ${s.max + 8} L52 ${s.max + 8}`, stroke: colors[tier], 'stroke-width': 1.5, opacity: .7 }, hall);
      const t = svgEl('text', {
        x: 38, y: (s.min + s.max) / 2, 'text-anchor': 'middle', class: 'zone-label',
        transform: `rotate(-90 38 ${(s.min + s.max) / 2})`, style: `fill:${colors[tier]};font-size:10px`
      }, hall);
      t.textContent = TIERS[tier].label.toUpperCase();
    });
  }

  /* ---------------- seat interaction ---------------- */
  function toggleSeat(id, opts = {}) {
    const s = seats.get(id);
    if (!s || s.taken) return;
    if (picked.has(id)) {
      picked.delete(id);
      s.el.classList.remove('picked');
    } else {
      if (picked.size >= MAX_SEATS) { toast(`You can pick up to <b>${MAX_SEATS}</b> seats in one booking.`); return; }
      picked.set(id, s);
      s.el.classList.add('picked');
      if (!opts.quiet) { s.el.classList.remove('pop'); void s.el.getBBox(); s.el.classList.add('pop'); }
    }
    updateSummary();
  }

  function clearSelection() {
    picked.forEach(s => s.el.classList.remove('picked'));
    picked.clear();
    updateSummary();
  }

  /* tooltip */
  const tip = $('#tooltip'), mapWrap = $('#mapWrap');
  function showTip(seat) {
    const r = seat.el.getBoundingClientRect(), w = mapWrap.getBoundingClientRect();
    const t = TIERS[seat.tier];
    tip.innerHTML = seat.taken
      ? `<b>Row ${seat.row} · Seat ${seat.num}</b><span style="color:var(--muted)">Already taken</span>`
      : `<b>Row ${seat.row} · Seat ${seat.num}</b><span class="t-${seat.tier}">${t.label}</span> · ${rs(t.price)}`;
    tip.style.left = (r.left + r.width / 2 - w.left + mapWrap.scrollLeft) + 'px';
    tip.style.top = (r.top - w.top + mapWrap.scrollTop) + 'px';
    tip.classList.add('show');
  }
  const hideTip = () => tip.classList.remove('show');

  /* zoom & pan via viewBox */
  const BASE = { w: 1000, h: 860 };
  const view = { z: 1, cx: 500, cy: 430 };
  function applyView() {
    const w = BASE.w / view.z, h = BASE.h / view.z;
    view.cx = Math.min(Math.max(view.cx, w / 2), BASE.w - w / 2);
    view.cy = Math.min(Math.max(view.cy, h / 2), BASE.h - h / 2);
    hall.setAttribute('viewBox', `${(view.cx - w / 2).toFixed(1)} ${(view.cy - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
    mapWrap.classList.toggle('pannable', view.z > 1);
  }
  function zoomTo(z, cx, cy) {
    view.z = Math.min(3, Math.max(1, z));
    if (cx != null) { view.cx = cx; view.cy = cy; }
    animateView();
  }
  let animRaf;
  function animateView() {           // smooth viewBox tween
    cancelAnimationFrame(animRaf);
    const vb = hall.viewBox.baseVal;
    const from = { x: vb.x, y: vb.y, w: vb.width };
    const w = BASE.w / view.z, h = BASE.h / view.z;
    const tcx = Math.min(Math.max(view.cx, w / 2), BASE.w - w / 2);
    const tcy = Math.min(Math.max(view.cy, h / 2), BASE.h - h / 2);
    const to = { x: tcx - w / 2, y: tcy - h / 2, w };
    const t0 = performance.now();
    (function step(now) {
      const k = Math.min(1, (now - t0) / 380), e = 1 - Math.pow(1 - k, 3);
      const cw = from.w + (to.w - from.w) * e;
      hall.setAttribute('viewBox', `${from.x + (to.x - from.x) * e} ${from.y + (to.y - from.y) * e} ${cw} ${cw * BASE.h / BASE.w}`);
      if (k < 1) animRaf = requestAnimationFrame(step); else applyView();
    })(t0);
  }

  function bindMap() {
    let drag = null, moved = false;
    hall.addEventListener('pointerdown', e => {
      moved = false;
      if (view.z <= 1) return;
      drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
    });
    addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) { moved = true; mapWrap.classList.add('panning'); hideTip(); }
      if (!moved) return;
      const scale = (BASE.w / view.z) / hall.getBoundingClientRect().width;
      view.cx = drag.cx - dx * scale; view.cy = drag.cy - dy * scale;
      applyView();
    });
    addEventListener('pointerup', () => { drag = null; mapWrap.classList.remove('panning'); });

    hall.addEventListener('click', e => {
      if (moved) { moved = false; return; }
      const g = e.target.closest('.seat');
      if (!g) return;
      const s = seats.get(g.dataset.id);
      if (s.taken) { toast(`Row ${s.row} seat ${s.num} is already taken.`); return; }
      toggleSeat(s.id);
    });
    hall.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.seat')) { e.preventDefault(); toggleSeat(e.target.closest('.seat').dataset.id); }
    });
    hall.addEventListener('pointerover', e => { const g = e.target.closest('.seat'); if (g && !drag) showTip(seats.get(g.dataset.id)); });
    hall.addEventListener('pointerout', e => { if (e.target.closest('.seat')) hideTip(); });
    hall.addEventListener('focusin', e => { const g = e.target.closest('.seat'); if (g) showTip(seats.get(g.dataset.id)); });
    hall.addEventListener('focusout', hideTip);
    hall.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomTo(view.z * (e.deltaY < 0 ? 1.25 : 0.8));
    }, { passive: false });

    $('#zoomIn').onclick = () => zoomTo(view.z * 1.35);
    $('#zoomOut').onclick = () => zoomTo(view.z / 1.35);
    $('#zoomReset').onclick = () => zoomTo(1, 500, 430);

    // legend filters
    $$('#legend [data-filter]').forEach(b => b.addEventListener('click', () => setFilter(b.classList.contains('active') ? null : b.dataset.filter)));
  }

  function setFilter(tier) {
    $$('#legend [data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === tier));
    hall.classList.toggle('filtering', !!tier);
    seats.forEach(s => s.el.classList.toggle('hl', s.tier === tier));
    if (tier) {
      const ys = [...seats.values()].filter(s => s.tier === tier).map(s => s.y);
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      zoomTo(tier === 'silver' ? 1.35 : 1.6, 500, cy);
      $('#bestTier').value = tier;
    } else zoomTo(1, 500, 430);
  }

  /* best available seats together */
  function bestSeats(tier, qty) {
    let best = null;
    const byRow = {};
    seats.forEach(s => { if (s.tier === tier) (byRow[s.row] ||= []).push(s); });
    Object.keys(byRow).sort().forEach((row, ri) => {
      const list = byRow[row];
      // split by block, look for runs of free seats
      [0, 1, 2].forEach(b => {
        const blk = list.filter(s => s.block === b);
        for (let i = 0; i + qty <= blk.length; i++) {
          const run = blk.slice(i, i + qty);
          if (run.some(s => s.taken || picked.has(s.id))) continue;
          const centre = (run[0].u + run[run.length - 1].u) / 2;
          const score = ri * 4 + Math.abs(centre - run[0].mid) * 0.9 + (b === 1 ? 0 : 1.5);
          if (!best || score < best.score) best = { score, run };
        }
      });
    });
    return best ? best.run : null;
  }

  /* hold timer */
  function startHold() {
    if (holdEnd) return;
    holdEnd = Date.now() + HOLD_SECONDS * 1000;
    $('#holdTimer').hidden = false;
    tickHold(); holdTimer = setInterval(tickHold, 1000);
  }
  function stopHold() { clearInterval(holdTimer); holdEnd = null; $('#holdTimer').hidden = true; }
  function tickHold() {
    const left = Math.max(0, Math.round((holdEnd - Date.now()) / 1000));
    $('#holdLeft').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('#holdTimer').classList.toggle('urgent', left < 60);
    if (left <= 0) { clearSelection(); toast('Your seat hold ran out, so the seats were released. Pick them again to continue.'); if (location.hash === '#checkout') go('seats'); }
  }

  /* summary */
  let shownTotal = 0;
  function totals() {
    const by = { gold: [], silver: [], bronze: [] };
    picked.forEach(s => by[s.tier].push(s));
    const total = Object.entries(by).reduce((a, [t, l]) => a + l.length * TIERS[t].price, 0);
    return { by, total };
  }
  function countUp(el, from, to) {
    const t0 = performance.now();
    (function f(now) {
      const k = Math.min(1, (now - t0) / 500), e = 1 - Math.pow(1 - k, 3);
      el.textContent = rs(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(f);
    })(t0);
  }
  function updateSummary() {
    const { by, total } = totals();
    const sorted = [...picked.values()].sort((a, b) => a.row.localeCompare(b.row) || a.num - b.num);
    $('#chips').innerHTML = sorted.map(s =>
      `<li class="chip ${s.tier}"><i></i>${s.id}<button aria-label="Remove ${s.id}" data-rm="${s.id}">×</button></li>`).join('');
    $('#breakdown').innerHTML = Object.entries(by).filter(([, l]) => l.length).map(([t, l]) =>
      `<div><span>${TIERS[t].label} × ${l.length}</span><span>${rs(l.length * TIERS[t].price)}</span></div>`).join('');
    $('#sumEmpty').hidden = picked.size > 0;
    $('#clearSel').hidden = picked.size === 0;
    $('#toCheckout').disabled = $('#mbarGo').disabled = picked.size === 0;
    $('#mbarCount').textContent = `${picked.size} seat${picked.size === 1 ? '' : 's'}`;
    if (total !== shownTotal) {
      const el = $('#total');
      countUp(el, shownTotal, total); countUp($('#mbarTotal'), shownTotal, total);
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      shownTotal = total;
    }
    picked.size ? startHold() : stopHold();
  }

  /* seats-left counters on tier cards */
  function updateAvailability() {
    const left = { gold: 0, silver: 0, bronze: 0 };
    seats.forEach(s => { if (!s.taken) left[s.tier]++; });
    $$('[data-left]').forEach(el => { el.textContent = left[el.dataset.left]; });
  }

  /* =========================================================
     CHECKOUT
     ========================================================= */
  function renderCheckout() {
    const { total } = totals();
    const sorted = [...picked.values()].sort((a, b) => a.row.localeCompare(b.row) || a.num - b.num);
    $('#coLines').innerHTML = sorted.map(s =>
      `<li class="${s.tier}"><span><i></i>Row ${s.row} · Seat ${s.num} <small style="color:var(--dim)">${TIERS[s.tier].label}</small></span><span>${rs(TIERS[s.tier].price)}</span></li>`).join('');
    $('#coTotal').textContent = rs(total);
    $('#payLbl').textContent = `Pay ${rs(total)} with PayHere`;
  }

  function validate() {
    const f = $('#coForm');
    let ok = true;
    ['first', 'last', 'email', 'phone'].forEach(n => {
      const i = f.elements[n];
      let bad = !i.value.trim();
      if (n === 'email' && !bad) bad = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.value.trim());
      if (n === 'phone' && !bad) bad = i.value.replace(/\D/g, '').length < 9;
      i.classList.toggle('bad', bad);
      if (bad) ok = false;
    });
    const err = $('#formError');
    if (!ok) { err.textContent = 'Please check the highlighted details.'; err.hidden = false; return false; }
    if (!f.elements.agree.checked) { err.textContent = 'Please tick the box to agree to the ticket terms.'; err.hidden = false; return false; }
    err.hidden = true; return true;
  }

  async function pay() {
    if (!picked.size) { go('seats'); return; }
    if (!validate()) return;
    const f = $('#coForm').elements;
    const { total } = totals();
    const id = 'WV26-' + Date.now().toString(36).toUpperCase().slice(-6);
    const order = {
      id, total, createdAt: new Date().toISOString(),
      customer: { first: f.first.value.trim(), last: f.last.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), role: f.role.value, student: f.student.value.trim() },
      seats: [...picked.values()].sort((a, b) => a.row.localeCompare(b.row) || a.num - b.num)
        .map(s => ({ id: s.id, row: s.row, num: s.num, tier: s.tier, price: TIERS[s.tier].price }))
    };
    const modal = $('#payModal');
    $('#payModalTitle').textContent = 'Contacting PayHere…';
    $('#payModalText').textContent = Payment.demo ? 'Demo mode: no money is taken.' : 'Finish the payment in the PayHere window.';
    modal.hidden = false;
    try {
      await Payment.pay(order);
      $('#payModalTitle').textContent = 'Payment confirmed';
      $('#payModalText').textContent = 'Printing your tickets…';
      await new Promise(r => setTimeout(r, 900));
      orders.unshift(order); store.set('wv_orders', orders);
      order.seats.forEach(x => { const s = seats.get(x.id); s.taken = true; s.el.classList.add('taken'); s.el.classList.remove('picked'); });
      picked.clear(); stopHold(); updateSummary(); updateAvailability();
      $('#coForm').reset();
      justPaidOrderId = order.id;
      modal.hidden = true;
      go('tickets');
      window.Snow && Snow.on && Snow.burst();
    } catch (err) {
      modal.hidden = true;
      toast('Payment did not go through: ' + err.message);
    }
  }

  /* =========================================================
     TICKETS
     ========================================================= */
  function barcode(str) {
    let h = hashStr(str), x = 0, bars = '';
    while (x < 118) {
      const w = 1 + (h & 3); h = Math.imul(h ^ (h >>> 7), 2654435761) >>> 0;
      bars += `<rect x="${x}" y="0" width="${w}" height="44"/>`;
      x += w + 1 + ((h >>> 3) & 3);
    }
    return `<svg viewBox="0 0 120 44" preserveAspectRatio="none">${bars}</svg>`;
  }
  const TREES = (() => {      // little pine-tree silhouette band
    let d = 'M0 46 ', x = 0; const r = seeded(7);
    while (x < 400) { const w = 10 + r() * 12, h = 18 + r() * 26; d += `L${x + w / 2} ${46 - h} L${x + w} 46 `; x += w * 0.75; }
    return d + 'L400 46 Z';
  })();

  function ticketHTML(order, s) {
    const t = TIERS[s.tier];
    const no = `${order.id}-${s.id}`;
    const trees = `<svg class="t-trees" viewBox="0 0 400 46" preserveAspectRatio="none"><path d="${TREES}"/></svg>`;
    return `
    <article class="ticket ${s.tier}" data-no="${no}">
      <div class="t-part t-stub">
        <div class="t-flakes"></div><div class="t-snowband"></div>${trees}
        <div><div class="script">Winter Vespers</div><div class="t-yr">2026</div></div>
        <div class="t-seat-big"><small>Row · Seat</small><b>${s.row}${s.num}</b><div class="t-no">${no}</div></div>
      </div>
      <div class="t-part t-main">
        <div class="t-flakes"></div><div class="t-snowband"></div>${trees}
        <div class="t-top">
          <div class="t-title">
            <div><span class="script">Winter Vespers</span><span class="t-yr">2026</span></div>
            <div class="t-hark">Hark! The Herald Angels are Singing</div>
            <div class="t-seatbox">
              <div><small>Row</small><b>${s.row}</b></div>
              <div><small>Seat</small><b>${s.num}</b></div>
              <div><small>Tier</small><b>${t.label}</b></div>
            </div>
          </div>
          <img class="t-logo" src="assets/img/sunico-logo.png" alt="SUNICO" />
        </div>
        <div class="t-info">
          <div class="venue">${EVENT.venue}</div>
          <div class="date"><small>${EVENT.day}</small><b>${EVENT.dayNum}<sup>th</sup></b><small>${EVENT.month}<br>${EVENT.year}</small></div>
          <div class="time">${EVENT.time}</div>
        </div>
        <div class="t-barcode">${barcode(no)}<small>${no}</small></div>
        <img class="t-coin" src="${t.coin}" alt="${t.label} coin ${rs(t.price)}" />
      </div>
      <div class="t-perf"></div>
      <div class="t-scissor"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg></div>
      <span class="t-hint">← drag to tear</span>
      <button class="t-tear-btn" type="button"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>Tear</button>
      <div class="t-admit">ADMITTED</div>
      <button class="t-restore" type="button">↺ Put the stub back</button>
    </article>`;
  }

  function renderTickets() {
    const box = $('#tickets');
    const all = orders.flatMap(o => o.seats.map(s => ({ o, s })));
    $('#ticketsEmpty').hidden = all.length > 0;
    $('#ticketsActions').hidden = all.length === 0;
    $('#ticketsLead').hidden = all.length === 0;
    $('#navTicketCount').hidden = all.length === 0;
    $('#navTicketCount').textContent = all.length;
    $('#ticketsTitle').textContent = all.length ? `Your tickets (${all.length})` : 'Your tickets';

    $('.success-burst')?.remove();
    if (justPaidOrderId) {
      const o = orders.find(x => x.id === justPaidOrderId);
      const div = document.createElement('div');
      div.className = 'success-burst';
      div.innerHTML = `<div><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M7 12.5l3.2 3.2L17 9"/></svg>
        <p><strong>You're booked, ${o.customer.first}!</strong>Order ${o.id} · ${o.seats.length} seat${o.seats.length > 1 ? 's' : ''} · ${rs(o.total)}${Payment.demo ? ' · demo payment' : ''}</p></div>`;
      box.before(div);
      justPaidOrderId = null;
    }

    box.innerHTML = all.map(({ o, s }) => ticketHTML(o, s)).join('');
    $$('.ticket', box).forEach((tk, i) => { tk.style.animationDelay = (i * 0.12) + 's'; bindTicket(tk); });
  }

  function bindTicket(tk) {
    const stub = $('.t-stub', tk);
    const tear = (dx = 0, rot = 0) => {
      if (tk.classList.contains('torn') || tk.classList.contains('cutting')) return;
      tk.style.setProperty('--dx', dx + 'px'); tk.style.setProperty('--rot', rot + 'deg');
      stub.style.transform = '';
      tk.classList.add('cutting');
      setTimeout(() => { tk.classList.remove('cutting'); tk.classList.add('torn'); }, dx ? 120 : 900);
    };
    $('.t-tear-btn', tk).addEventListener('click', () => tear());
    $('.t-restore', tk).addEventListener('click', () => { tk.classList.remove('torn'); stub.style.transform = ''; });

    // drag the stub left to tear it off (desktop layout)
    let start = null;
    stub.addEventListener('pointerdown', e => {
      if (innerWidth <= 860 || tk.classList.contains('torn')) return;
      start = e.clientX; stub.setPointerCapture(e.pointerId);
      stub.classList.add('dragging'); stub.classList.remove('snap');
    });
    stub.addEventListener('pointermove', e => {
      if (start == null) return;
      const dx = Math.min(0, e.clientX - start);
      stub.style.transform = `translateX(${dx}px) rotate(${dx / 14}deg)`;
      stub.style.transformOrigin = '100% 0';
    });
    const end = e => {
      if (start == null) return;
      const dx = Math.min(0, e.clientX - start); start = null;
      stub.classList.remove('dragging');
      if (dx < -90) tear(dx, dx / 14);
      else { stub.classList.add('snap'); stub.style.transform = ''; }
    };
    stub.addEventListener('pointerup', end);
    stub.addEventListener('pointercancel', end);
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  const VIEWS = ['home', 'seats', 'checkout', 'tickets'];
  function go(v) { if (location.hash === '#' + v) route(); else location.hash = v; }
  function route() {
    let v = location.hash.slice(1) || 'home';
    let anchor = null;
    if (!VIEWS.includes(v)) { anchor = v; v = 'home'; }
    if (v === 'checkout' && !picked.size) { v = 'seats'; history.replaceState(null, '', '#seats'); toast('Pick at least one seat first.'); }
    const cur = $('.view.active');
    const next = $('#view-' + v);
    if (cur !== next) { cur?.classList.remove('active'); next.classList.add('active'); }
    $$('.nav-links a').forEach(a => a.classList.toggle('on', a.dataset.go === v));
    if (v === 'checkout') renderCheckout();
    if (v === 'tickets') renderTickets();
    if (anchor && document.getElementById(anchor)) setTimeout(() => document.getElementById(anchor).scrollIntoView({ behavior: 'smooth' }), 60);
    else scrollTo({ top: 0, behavior: cur === next ? 'smooth' : 'instant' });
    observeReveals();
  }

  /* =========================================================
     HOME EXTRAS
     ========================================================= */
  function countdown() {
    const target = new Date(EVENT.dateISO).getTime();
    const els = { d: $('[data-cd=d]'), h: $('[data-cd=h]'), m: $('[data-cd=m]'), s: $('[data-cd=s]') };
    const set = (el, v) => { v = String(v).padStart(2, '0'); if (el.textContent !== v) { el.textContent = v; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); } };
    function tick() {
      let ms = Math.max(0, target - Date.now());
      const d = Math.floor(ms / 864e5); ms -= d * 864e5;
      const h = Math.floor(ms / 36e5); ms -= h * 36e5;
      const m = Math.floor(ms / 6e4); ms -= m * 6e4;
      set(els.d, d); set(els.h, h); set(els.m, m); set(els.s, Math.floor(ms / 1000));
    }
    tick(); setInterval(tick, 1000);
  }

  function treeLine() {
    let d = 'M0 120 ', x = 0; const r = seeded(42);
    while (x < 1440) {
      const w = 26 + r() * 40, h = 40 + r() * 75;
      d += `L${x + w * .2} ${120 - h * .35} L${x + w * .32} ${120 - h * .35} L${x + w / 2} ${120 - h} L${x + w * .68} ${120 - h * .35} L${x + w * .8} ${120 - h * .35} L${x + w} 120 `;
      x += w * 0.8;
    }
    $('#treePath').setAttribute('d', d + 'L1440 120 Z');
  }

  let io;
  function observeReveals() {
    io ||= new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
    $$('.view.active .reveal:not(.in)').forEach(el => io.observe(el));
  }

  function tilt() {
    $$('.tier-card').forEach(c => {
      c.addEventListener('pointermove', e => {
        const r = c.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        c.style.transform = `perspective(900px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-6px)`;
      });
      c.addEventListener('pointerleave', () => { c.style.transform = ''; });
    });
  }

  /* =========================================================
     INIT
     ========================================================= */
  function init() {
    buildHall();
    bindMap();
    updateSummary();
    updateAvailability();
    countdown();
    treeLine();
    tilt();
    $('#maxSeatsLbl').textContent = MAX_SEATS;

    // nav links / buttons
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-go]');
      if (a) { e.preventDefault(); go(a.dataset.go); }
      const rm = e.target.closest('[data-rm]');
      if (rm) toggleSeat(rm.dataset.rm);
      const pt = e.target.closest('[data-pick-tier]');
      if (pt) { go('seats'); setTimeout(() => setFilter(pt.dataset.pickTier), 350); }
    });
    addEventListener('hashchange', route);
    addEventListener('scroll', () => $('#nav').classList.toggle('scrolled', scrollY > 20), { passive: true });

    $('#clearSel').onclick = clearSelection;
    $('#toCheckout').onclick = $('#mbarGo').onclick = () => go('checkout');
    $('#payBtn').onclick = pay;
    $('#coForm').addEventListener('input', e => e.target.classList.remove('bad'));
    $('#printBtn').onclick = () => print();

    // quick pick
    let qty = 2;
    const setQty = n => { qty = Math.max(1, Math.min(MAX_SEATS, n)); $('#qty').textContent = qty; };
    $('#qtyMinus').onclick = () => setQty(qty - 1);
    $('#qtyPlus').onclick = () => setQty(qty + 1);
    $('#bestBtn').onclick = () => {
      const tier = $('#bestTier').value;
      if (picked.size + qty > MAX_SEATS) { toast(`That would go over ${MAX_SEATS} seats. Remove some first.`); return; }
      const run = bestSeats(tier, qty);
      if (!run) { toast(`No ${qty} ${TIERS[tier].label} seats left side by side. Try fewer seats or another tier.`); return; }
      run.forEach((s, i) => setTimeout(() => toggleSeat(s.id), i * 90));
      const cy = run[0].y;
      zoomTo(1.7, run.reduce((a, s) => a + s.x, 0) / run.length, cy);
      toast(`Picked ${run.map(s => s.id).join(', ')} — ${TIERS[tier].label}, side by side.`);
    };

    $('#snowToggle').onclick = () => { const on = Snow.toggle(); $('#snowToggle').classList.toggle('off', !on); };
    $('#resetDemo').onclick = () => { if (confirm('Clear all demo bookings and tickets on this device?')) { localStorage.removeItem('wv_orders'); location.hash = 'home'; location.reload(); } };

    // gallery lightbox
    const lb = $('#lightbox');
    $$('.g').forEach(g => g.addEventListener('click', () => { $('img', lb).src = $('img', g).src; lb.hidden = false; }));
    lb.addEventListener('click', () => { lb.hidden = true; });
    addEventListener('keydown', e => { if (e.key === 'Escape') lb.hidden = true; });

    // hero reveals straight away
    requestAnimationFrame(() => $$('.hero .reveal').forEach(el => el.classList.add('in')));
    route();
    renderTickets();   // nav badge count
  }

  init();
})();
