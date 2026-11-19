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
  let bookings = [];                       // all booking records (from DB)
  let myRefs = store.get('wv_my_refs', []); // bookings made / found on this device
  let holdEnd = null, holdTimer = null;
  let justPaidRef = null;

  /* =========================================================
     HALL PLAN (SVG)
     ========================================================= */
  const hall = $('#hall');
  const CX = 500, CY = -1100;              // centre of the curved rows (far behind the stage)
  const FLOOR_R0 = 1300, ROW_GAP = 46, GALLERY_GAP = 120;
  const SEAT_STEP = 32, AISLE = 1.9;
  const FLOOR_ROWS = ROWS.filter(r => r.zone === 'floor').length;
  const GAL_ROWS = ROWS.length - FLOOR_ROWS;
  const radiusOf = (zone, i) => zone === 'floor'
    ? FLOOR_R0 + i * ROW_GAP
    : FLOOR_R0 + (FLOOR_ROWS - 1) * ROW_GAP + GALLERY_GAP + i * ROW_GAP;
  const HALL_H = Math.round(CY + radiusOf('gallery', GAL_ROWS - 1) + 52);

  function buildHall() {
    hall.innerHTML = '';
    hall.setAttribute('viewBox', `0 0 1000 ${HALL_H}`);
    mapWrap.style.setProperty('--hall-ar', `1000 / ${HALL_H}`);
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
      d: `M40 26 Q40 8 60 8 L940 8 Q960 8 960 26 L994 ${HALL_H * .62} L994 ${HALL_H - 10} Q994 ${HALL_H - 4} 988 ${HALL_H - 4} L12 ${HALL_H - 4} Q6 ${HALL_H - 4} 6 ${HALL_H - 10} L6 ${HALL_H * .62} Z`,
      fill: 'rgba(255,255,255,.015)', stroke: 'rgba(255,255,255,.08)', 'stroke-width': 1.5
    }, hall);

    // Screen + stage
    svgEl('ellipse', { cx: 500, cy: 40, rx: 360, ry: 120, fill: 'url(#stageGlow)', class: 'stage-glow' }, hall);
    svgEl('path', { d: 'M270 24 Q500 12 730 24', stroke: '#fff', 'stroke-width': 8, filter: 'url(#blur8)', opacity: .6 }, hall);
    svgEl('path', { d: 'M270 24 Q500 12 730 24', stroke: 'url(#screenFill)', 'stroke-width': 4 }, hall);
    const sl = svgEl('text', { x: 500, y: 44, 'text-anchor': 'middle', class: 'stage-sub' }, hall); sl.textContent = 'SCREEN';
    svgEl('path', {
      d: 'M205 54 L795 54 L765 132 Q500 164 235 132 Z',
      fill: 'url(#stageFill)', stroke: 'rgba(246,220,147,.55)', 'stroke-width': 1.5
    }, hall);
    const st = svgEl('text', { x: 505, y: 110, 'text-anchor': 'middle', class: 'stage-label' }, hall); st.textContent = 'STAGE';

    // Gallery band
    const gR1 = radiusOf('gallery', 0) - 40, gR2 = radiusOf('gallery', GAL_ROWS - 1) + 30;
    const ga = 14.6 * SEAT_STEP / gR1;
    const p = (R, a) => `${(CX + R * Math.sin(a)).toFixed(1)} ${(CY + R * Math.cos(a)).toFixed(1)}`;
    svgEl('path', {
      d: `M${p(gR1, -ga)} A${gR1} ${gR1} 0 0 0 ${p(gR1, ga)} L${p(gR2, ga)} A${gR2} ${gR2} 0 0 1 ${p(gR2, -ga)} Z`,
      fill: 'rgba(196,127,78,.05)', stroke: 'rgba(196,127,78,.25)', 'stroke-width': 1
    }, hall);
    svgEl('path', { d: `M${p(gR1, -ga)} A${gR1} ${gR1} 0 0 0 ${p(gR1, ga)}`, stroke: 'rgba(196,127,78,.6)', 'stroke-width': 3, 'stroke-dasharray': '2 6' }, hall);
    const gl = svgEl('text', { x: 500, y: CY + gR1 - 14, 'text-anchor': 'middle', class: 'zone-label' }, hall);
    gl.textContent = 'GALLERY · UPPER LEVEL';

    // Entrances (between the floor and the gallery)
    const ey = Math.round(CY + (radiusOf('floor', FLOOR_ROWS - 1) + gR1) / 2 - 20);
    [[22, 'start'], [978, 'end']].forEach(([x, a]) => {
      const t = svgEl('text', { x, y: ey + 4, 'text-anchor': a, class: 'zone-label', style: 'font-size:10px' }, hall);
      t.textContent = 'ENTRANCE';
      const wx = a === 'start' ? 9 : 991;
      svgEl('path', { d: `M${wx} ${ey - 22} L${wx} ${ey + 22}`, stroke: 'rgba(231,189,90,.8)', 'stroke-width': 5 }, hall);
    });

    // Seats
    const rand = seeded(20261218);
    const booked = new Set(bookings.flatMap(b => b.tickets.map(t => t.seat)));
    const gSeats = svgEl('g', { id: 'seatGroup' }, hall);
    let floorIdx = 0, galIdx = 0;
    const tierSpans = {};

    ROWS.forEach(rowDef => {
      const R = rowDef.zone === 'floor' ? radiusOf('floor', floorIdx++) : radiusOf('gallery', galIdx++);

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
        // invisible, larger tap area so seats are easy to hit on phones
        svgEl('rect', { x: -16, y: -15, width: 32, height: 32, fill: 'transparent', class: 's-hit' }, g);
        // inner group so CSS scale doesn't fight the transform attribute
        const inner = svgEl('g', { class: 'seat-in' }, g);
        svgEl('rect', { x: -13, y: 7, width: 26, height: 7, rx: 2.5, class: 's-back' }, inner);
        svgEl('rect', { x: -13, y: -12, width: 26, height: 21, rx: 6, class: 's-body' }, inner);
        svgEl('path', { d: 'M-5.5 -7 L5.5 4 M5.5 -7 L-5.5 4', class: 's-x' }, inner);
        svgEl('path', { d: 'M-6.5 -1.5 L-2 3 L6.5 -6', class: 's-check' }, inner);
        const n = svgEl('text', { x: 0, y: 3, 'text-anchor': 'middle', class: 's-num' }, inner);
        n.textContent = num;
        seat.el = g;
        seats.set(id, seat);

        if (i === 0 || i === units.length - 1) {
          const off = (i === 0 ? -1.35 : 1.35) * SEAT_STEP / R;
          const lx = CX + R * Math.sin(theta + off), ly = CY + R * Math.cos(theta + off);
          const t = svgEl('text', { x: lx.toFixed(1), y: (ly + 5).toFixed(1), 'text-anchor': 'middle', class: 'row-lbl' }, hall);
          t.textContent = rowDef.row;
        }
      });
      const ts = tierSpans[rowDef.tier] || (tierSpans[rowDef.tier] = { min: Infinity, max: -Infinity });
      ts.min = Math.min(ts.min, CY + R); ts.max = Math.max(ts.max, CY + R);
    });
    hall.appendChild(gSeats);   // seats on top of labels
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
      ? `<b>Row ${seat.row} · Seat ${seat.num}</b><span style="color:#ff6b81">Booked</span>`
      : `<b>Row ${seat.row} · Seat ${seat.num}</b><span class="t-${seat.tier}">${t.label}</span> · ${rs(t.price)}`;
    tip.style.left = (r.left + r.width / 2 - w.left + mapWrap.scrollLeft) + 'px';
    tip.style.top = (r.top - w.top + mapWrap.scrollTop) + 'px';
    tip.classList.add('show');
  }
  const hideTip = () => tip.classList.remove('show');

  /* zoom & pan via viewBox */
  const BASE = { w: 1000, h: HALL_H };
  const view = { z: 1, cx: 500, cy: HALL_H / 2 };
  // On phones the map sits in a tall frame, so the visible area follows the frame's shape.
  const fitMode = () => matchMedia('(max-width: 700px)').matches;
  function viewAR() {
    if (!fitMode()) return BASE.h / BASE.w;
    const r = mapWrap.getBoundingClientRect();
    return r.width ? r.height / r.width : BASE.h / BASE.w;
  }
  const clampC = (c, size, max) => size >= max ? max / 2 : Math.min(Math.max(c, size / 2), max - size / 2);
  function viewSize() { const w = BASE.w / view.z; return { w, h: w * viewAR() }; }
  function applyView() {
    const { w, h } = viewSize();
    view.cx = clampC(view.cx, w, BASE.w);
    view.cy = clampC(view.cy, h, BASE.h);
    hall.setAttribute('viewBox', `${(view.cx - w / 2).toFixed(1)} ${(view.cy - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
    mapWrap.classList.toggle('pannable', view.z > 1);
    mapWrap.classList.toggle('zoomed', view.z > 1.05);
  }
  function zoomTo(z, cx, cy) {
    view.z = Math.min(3.2, Math.max(1, z));
    mapWrap.classList.toggle('zoomed', view.z > 1.05);   // on phones the frame grows when zoomed
    if (cx != null) { view.cx = cx; view.cy = cy; }
    animateView();
  }
  let animRaf;
  function animateView() {           // smooth viewBox tween
    cancelAnimationFrame(animRaf);
    const vb = hall.viewBox.baseVal;
    const from = { x: vb.x, y: vb.y, w: vb.width };
    const { w, h } = viewSize(), ar = viewAR();
    const tcx = clampC(view.cx, w, BASE.w);
    const tcy = clampC(view.cy, h, BASE.h);
    const to = { x: tcx - w / 2, y: tcy - h / 2, w };
    const t0 = performance.now();
    (function step(now) {
      const k = Math.min(1, (now - t0) / 380), e = 1 - Math.pow(1 - k, 3);
      const cw = from.w + (to.w - from.w) * e;
      hall.setAttribute('viewBox', `${from.x + (to.x - from.x) * e} ${from.y + (to.y - from.y) * e} ${cw} ${cw * ar}`);
      if (k < 1) animRaf = requestAnimationFrame(step); else applyView();
    })(t0);
  }

  // screen point -> hall (SVG) coordinates
  function toHall(clientX, clientY) {
    const pt = hall.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(hall.getScreenCTM().inverse());
  }
  // on small screens seats are tiny when the whole hall is shown, so a tap zooms in first
  const smallScreen = () => hall.getBoundingClientRect().width < 640;
  const tapZoom = () => Math.min(3, 1000 / 380);   // about 12 seats across

  function bindMap() {
    const pts = new Map();            // active pointers (for pinch)
    let drag = null, pinch = null, moved = false;

    hall.addEventListener('pointerdown', e => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        moved = false;
        drag = view.z > 1 ? { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy } : null;
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.z, anchor: toHall(mx, my) };
        drag = null; moved = true; hideTip();
      }
    });
    addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const r = hall.getBoundingClientRect();
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        view.z = Math.min(3.5, Math.max(1, pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
        const { w, h } = viewSize();
        view.cx = pinch.anchor.x - ((mx - r.left) / r.width - .5) * w;
        view.cy = pinch.anchor.y - ((my - r.top) / r.height - .5) * h;
        applyView();
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) { moved = true; mapWrap.classList.add('panning'); hideTip(); }
      if (!moved) return;
      const scale = (BASE.w / view.z) / hall.getBoundingClientRect().width;
      view.cx = drag.cx - dx * scale; view.cy = drag.cy - dy * scale;
      applyView();
    });
    const up = e => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) { drag = null; mapWrap.classList.remove('panning'); }
    };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);

    hall.addEventListener('click', e => {
      if (moved) { moved = false; return; }
      if (smallScreen() && view.z < 1.6) {          // first tap: zoom into that part of the hall
        const p = toHall(e.clientX, e.clientY);
        zoomTo(tapZoom(), p.x, p.y);
        hideTip();
        return;
      }
      const g = e.target.closest('.seat');
      if (!g) return;
      const s = seats.get(g.dataset.id);
      if (s.taken) { toast(`Row ${s.row} seat ${s.num} is already booked.`); return; }
      toggleSeat(s.id);
    });
    hall.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.seat')) { e.preventDefault(); toggleSeat(e.target.closest('.seat').dataset.id); }
    });
    hall.addEventListener('pointerover', e => { if (e.pointerType === 'touch') return; const g = e.target.closest('.seat'); if (g) showTip(seats.get(g.dataset.id)); });
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
    $('#zoomReset').onclick = () => zoomTo(1, 500, HALL_H / 2);

    // legend filters
    $$('#legend [data-filter]').forEach(b => b.addEventListener('click', () => {
      const f = b.dataset.filter;
      setFilter(f === 'all' || b.classList.contains('active') ? null : f);
    }));
    addEventListener('resize', () => { clearTimeout(bindMap._r); bindMap._r = setTimeout(applyView, 120); });
  }

  function setFilter(tier) {
    $$('#legend [data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === (tier || 'all')));
    hall.classList.toggle('filtering', !!tier);
    seats.forEach(s => s.el.classList.toggle('hl', s.tier === tier));
    if (tier) {
      const ys = [...seats.values()].filter(s => s.tier === tier).map(s => s.y);
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      if (fitMode()) zoomTo(tapZoom(), 500, cy);   // phones: zoom right in so seats are easy to tap
      else zoomTo(tier === 'silver' ? 1.35 : 1.6, 500, cy);
      $('#bestTier').value = tier;
    } else zoomTo(1, 500, HALL_H / 2);
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

  function markTaken(ids) {
    ids.forEach(id => { const s = seats.get(id); if (!s) return; s.taken = true; s.el.classList.add('taken'); s.el.classList.remove('picked'); picked.delete(id); });
  }

  async function pay() {
    if (!picked.size) { go('seats'); return; }
    if (!validate()) return;
    const f = $('#coForm').elements;
    const { total } = totals();
    const ref = DB.newRef();
    const booking = {
      ref, status: Payment.demo ? 'paid-demo' : 'paid', paymentId: null,
      amount: total, currency: 'LKR', createdAt: new Date().toISOString(),
      customer: { first: f.first.value.trim(), last: f.last.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), role: f.role.value, student: f.student.value.trim() },
      tickets: [...picked.values()].sort((a, b) => a.row.localeCompare(b.row) || a.num - b.num)
        .map(s => ({ ticketId: `${ref}-${s.id}`, seat: s.id, row: s.row, num: s.num, tier: s.tier, price: TIERS[s.tier].price, checkedInAt: null }))
    };
    const modal = $('#payModal');
    $('#payModalTitle').textContent = 'Contacting PayHere…';
    $('#payModalText').textContent = Payment.demo ? 'Demo mode: no money is taken.' : 'Finish the payment in the PayHere window.';
    modal.hidden = false;
    try {
      const res = await Payment.pay(booking);
      booking.paymentId = res.paymentId || null;
      $('#payModalTitle').textContent = 'Payment confirmed';
      $('#payModalText').textContent = `Recording booking ${ref}…`;
      await DB.create(booking);
      await new Promise(r => setTimeout(r, 700));
      bookings.unshift(booking);
      myRefs = [ref, ...myRefs.filter(r => r !== ref)]; store.set('wv_my_refs', myRefs);
      markTaken(booking.tickets.map(t => t.seat));
      stopHold(); updateSummary(); updateAvailability();
      $('#coForm').reset();
      justPaidRef = ref;
      modal.hidden = true;
      go('tickets');
      window.Snow && Snow.on && Snow.burst();
    } catch (err) {
      modal.hidden = true;
      bookings = await DB.all();
      markTaken(bookings.flatMap(b => b.tickets.map(t => t.seat)));
      updateSummary(); updateAvailability();
      toast('Booking not completed: ' + err.message);
    }
  }

  /* =========================================================
     TICKETS
     ========================================================= */
  function qrSVG(text) {
    const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
    const n = qr.getModuleCount(); let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
  }
  const TREES = (() => {      // little pine-tree silhouette band
    let d = 'M0 46 ', x = 0; const r = seeded(7);
    while (x < 400) { const w = 10 + r() * 12, h = 18 + r() * 26; d += `L${x + w / 2} ${46 - h} L${x + w} 46 `; x += w * 0.75; }
    return d + 'L400 46 Z';
  })();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = iso => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fullName = b => `${b.customer.first} ${b.customer.last}`;

  function ticketHTML(b, t) {
    const tier = TIERS[t.tier];
    const trees = `<svg class="t-trees" viewBox="0 0 400 46" preserveAspectRatio="none"><path d="${TREES}"/></svg>`;
    return `
    <article class="ticket ${t.tier}${t.checkedInAt ? ' used' : ''}" data-no="${t.ticketId}">
      <div class="t-part t-stub">
        <div class="t-flakes"></div><div class="t-snowband"></div>${trees}
        <div><div class="script">Winter Vespers</div><div class="t-yr">2026</div></div>
        <div class="t-seat-big"><small>Row · Seat</small><b>${t.seat}</b><div class="t-name">${esc(fullName(b))}</div><div class="t-no">${t.ticketId}</div></div>
      </div>
      <div class="t-part t-main">
        <div class="t-flakes"></div><div class="t-snowband"></div>${trees}
        <div class="t-top">
          <div class="t-title">
            <div><span class="script">Winter Vespers</span><span class="t-yr">2026</span></div>
            <div class="t-hark">Hark! The Herald Angels are Singing</div>
            <div class="t-seatbox">
              <div><small>Row</small><b>${t.row}</b></div>
              <div><small>Seat</small><b>${t.num}</b></div>
              <div><small>Tier</small><b>${tier.label}</b></div>
            </div>
          </div>
          <img class="t-logo" src="assets/img/sunico-logo.png" alt="SUNICO" />
        </div>
        <div class="t-info">
          <div class="venue">${EVENT.venue}</div>
          <div class="date"><small>${EVENT.day}</small><b>${EVENT.dayNum}<sup>th</sup></b><small>${EVENT.month}<br>${EVENT.year}</small></div>
          <div class="time">${EVENT.time}</div>
        </div>
        <div class="t-qr">${qrSVG(t.ticketId)}<small>${t.ticketId}</small></div>
        <img class="t-coin" src="${tier.coin}" alt="${tier.label} coin ${rs(tier.price)}" />
      </div>
      <div class="t-perf"></div>
      <div class="t-scissor"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg></div>
      <span class="t-hint">← drag to tear</span>
      <button class="t-tear-btn" type="button"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>Tear</button>
      <div class="t-admit">ADMITTED</div>
      <button class="t-restore" type="button">↺ Put the stub back</button>
    </article>`;
  }

  function statusLabel(b) { return b.status === 'paid-demo' ? 'Paid (demo)' : b.status === 'paid' ? 'Paid' : b.status; }

  function renderTickets() {
    const box = $('#ticketList');
    const mine = myRefs.map(r => bookings.find(b => b.ref === r)).filter(Boolean);
    const count = mine.reduce((a, b) => a + b.tickets.length, 0);
    $('#ticketsEmpty').hidden = count > 0;
    $('#ticketsActions').hidden = count === 0;
    $('#ticketsLead').hidden = count === 0;
    $('#navTicketCount').hidden = count === 0;
    $('#navTicketCount').textContent = count;
    $('#menuTicketCount').hidden = count === 0; $('#menuTicketCount').textContent = count;
    $('#ticketsTitle').textContent = count ? `Your tickets (${count})` : 'Your tickets';

    $('.success-burst')?.remove();
    if (justPaidRef) {
      const b = mine.find(x => x.ref === justPaidRef);
      const div = document.createElement('div');
      div.className = 'success-burst';
      div.innerHTML = `<div class="confirm">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M7 12.5l3.2 3.2L17 9"/></svg>
        <div class="confirm-text">
          <strong>You're booked, ${esc(b.customer.first)}!</strong>
          <p>${b.tickets.length} seat${b.tickets.length > 1 ? 's' : ''} · ${rs(b.amount)} · ${statusLabel(b)}. Take a screenshot of this booking number. You'll need it, with your phone number, to find your tickets again.</p>
        </div>
        <div class="confirm-ref"><small>Booking number</small><b>${b.ref}</b><button class="btn btn-ghost btn-sm" data-copy="${b.ref}">Copy</button></div>
      </div>`;
      box.before(div);
      justPaidRef = null;
    }

    box.innerHTML = mine.map(b => `
      <section class="bk">
        <header class="bk-head">
          <div class="bk-ref"><small>Booking number</small><b>${b.ref}</b><button class="icon-btn" data-copy="${b.ref}" title="Copy booking number"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg></button></div>
          <div class="bk-meta"><span>${esc(fullName(b))}</span><span>${b.tickets.length} ticket${b.tickets.length > 1 ? 's' : ''}</span><span>${rs(b.amount)}</span><span class="ok">${statusLabel(b)}</span><span>${fmtDate(b.createdAt)}</span></div>
        </header>
        <div class="bk-tickets">${b.tickets.map(t => ticketHTML(b, t)).join('')}</div>
      </section>`).join('');
    $$('.ticket', box).forEach((tk, i) => { tk.style.animationDelay = (i * 0.1) + 's'; bindTicket(tk); });
  }

  async function findBooking(e) {
    e.preventDefault();
    const f = e.target.elements;
    const b = await DB.lookup(f.ref.value, f.phone.value);
    const msg = $('#findMsg');
    if (!b) { msg.textContent = "We couldn't find a booking with that number and phone. Check both and try again."; msg.hidden = false; return; }
    msg.hidden = true;
    bookings = await DB.all();
    myRefs = [b.ref, ...myRefs.filter(r => r !== b.ref)]; store.set('wv_my_refs', myRefs);
    e.target.reset();
    renderTickets();
    toast(`Found booking <b>${b.ref}</b>: ${b.tickets.length} ticket${b.tickets.length > 1 ? 's' : ''}.`);
    $('#ticketList').scrollIntoView({ behavior: 'smooth' });
  }

  /* =========================================================
     STAFF PAGE — bookings record + door check-in
     ========================================================= */
  const STAFF_PIN = '2026';     // demo only: change it, and use real logins once there is a server
  let staffOpen = sessionStorage.getItem('wv_staff') === '1';
  let adminQuery = '';

  async function renderAdmin() {
    $('#adminGate').hidden = staffOpen;
    $('#adminPanel').hidden = !staffOpen;
    if (!staffOpen) { setTimeout(() => $('#pinInput').focus(), 100); return; }
    bookings = await DB.all();

    const tickets = bookings.flatMap(b => b.tickets);
    const revenue = bookings.reduce((a, b) => a + b.amount, 0);
    const inside = tickets.filter(t => t.checkedInAt).length;
    const left = { gold: 0, silver: 0, bronze: 0 };
    seats.forEach(s => { if (!s.taken) left[s.tier]++; });
    $('#stats').innerHTML = `
      <div><small>Bookings</small><b>${bookings.length}</b></div>
      <div><small>Tickets sold</small><b>${tickets.length}</b></div>
      <div><small>Money collected</small><b>${rs(revenue)}</b></div>
      <div><small>Checked in</small><b>${inside} <em>/ ${tickets.length}</em></b></div>
      <div><small>Seats left</small><b class="left"><span class="g">${left.gold}<i>Gold</i></span><span class="s">${left.silver}<i>Silver</i></span><span class="b">${left.bronze}<i>Bronze</i></span></b></div>`;

    const q = adminQuery.toLowerCase().replace(/\s+/g, '');
    const rows = bookings.filter(b => !q || [b.ref, fullName(b), b.customer.phone, b.customer.email, b.customer.student, ...b.tickets.map(t => t.seat)]
      .join('|').toLowerCase().replace(/\s+/g, '').includes(q));
    $('#bkCount').textContent = `${rows.length} of ${bookings.length}`;
    $('#bkBody').innerHTML = rows.length ? rows.map(b => {
      const ins = b.tickets.filter(t => t.checkedInAt).length;
      return `<tr class="bk-row" data-ref="${b.ref}">
        <td class="mono">${b.ref}</td>
        <td>${esc(fullName(b))}<small>${esc(b.customer.role)}${b.customer.student ? ' · ' + esc(b.customer.student) : ''}</small></td>
        <td>${esc(b.customer.phone)}<small>${esc(b.customer.email)}</small></td>
        <td>${b.tickets.map(t => `<span class="seat-tag ${t.tier}${t.checkedInAt ? ' in' : ''}">${t.seat}</span>`).join('')}</td>
        <td class="num">${rs(b.amount)}</td>
        <td><span class="status ok">${statusLabel(b)}</span></td>
        <td class="num">${ins}/${b.tickets.length}</td>
        <td><small>${fmtDate(b.createdAt)}</small></td>
      </tr>`;
    }).join('') : `<tr><td colspan="8" class="empty">${bookings.length ? 'No bookings match your search.' : 'No bookings yet.'}</td></tr>`;
  }

  function resultCard(kind, booking, ticket, extra = '') {
    const box = $('#ciResult');
    const titles = { ok: 'Valid ticket · checked in', already: 'Already checked in', missing: 'Ticket not found', booking: 'Booking found' };
    let body = '';
    if (booking) {
      const tks = ticket ? [ticket] : booking.tickets;
      body = `
        <div class="ci-who"><b>${esc(fullName(booking))}</b><span>${esc(booking.customer.phone)} · ${booking.ref} · ${statusLabel(booking)}</span></div>
        <ul class="ci-tickets">${tks.map(t => `
          <li class="${t.tier}">
            <span class="seat-tag ${t.tier}">${t.seat}</span>
            <span>${TIERS[t.tier].label} · ${t.ticketId}</span>
            ${t.checkedInAt
              ? `<em>In at ${new Date(t.checkedInAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}</em><button class="link-btn" data-undo="${t.ticketId}">Undo</button>`
              : `<button class="btn btn-gold btn-sm" data-checkin="${t.ticketId}">Check in</button>`}
          </li>`).join('')}</ul>`;
    }
    box.className = 'ci-result ' + kind;
    box.innerHTML = `<div class="ci-title">${titles[kind]}</div>${extra}${body}`;
    box.hidden = false;
  }

  async function doCheckIn(code) {
    code = String(code || '').toUpperCase().trim();
    if (!code) return;
    if (/^WV-[A-Z0-9]{6}$/.test(code)) {             // a booking number: show all its tickets
      const b = await DB.byRef(code);
      b ? resultCard('booking', b) : resultCard('missing', null, null, `<p>No booking <b>${esc(code)}</b>.</p>`);
      return;
    }
    const r = await DB.checkIn(code);
    if (r.result === 'missing') resultCard('missing', null, null, `<p>No ticket <b>${esc(code)}</b>. Check the number, or search the bookings by name or phone.</p>`);
    else if (r.result === 'already') resultCard('already', r.booking, r.ticket, `<p>This ticket was already used. Ask for ID before letting them in.</p>`);
    else { resultCard('ok', r.booking, r.ticket); try { navigator.vibrate && navigator.vibrate(80); } catch {} }
    $('#ciInput').value = '';
    renderAdmin();
  }

  /* camera QR scanner */
  let camStream = null, camRaf = null;
  async function startScan() {
    const video = $('#ciVideo'), wrap = $('#ciCam');
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch {
      toast('Camera not available. Use https (or localhost) and allow camera access, or type the ticket number.');
      return;
    }
    video.srcObject = camStream; await video.play();
    wrap.hidden = false; $('#scanBtn').textContent = 'Stop camera';
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
    let last = '', lastAt = 0;
    (function loop() {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        cv.width = video.videoWidth; cv.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const img = ctx.getImageData(0, 0, cv.width, cv.height);
        const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (hit && hit.data && (hit.data !== last || Date.now() - lastAt > 4000)) {
          last = hit.data; lastAt = Date.now();
          wrap.classList.add('hit'); setTimeout(() => wrap.classList.remove('hit'), 500);
          doCheckIn(hit.data);
        }
      }
      camRaf = requestAnimationFrame(loop);
    })();
  }
  function stopScan() {
    cancelAnimationFrame(camRaf);
    camStream?.getTracks().forEach(t => t.stop()); camStream = null;
    $('#ciCam').hidden = true; $('#scanBtn').textContent = 'Scan QR with camera';
  }

  function exportCSV() {
    const head = ['Booking number', 'Ticket number', 'Seat', 'Tier', 'Price (LKR)', 'First name', 'Last name', 'Phone', 'Email', 'Joining as', 'Student', 'Status', 'Payment ID', 'Booked at', 'Checked in at'];
    const lines = [head];
    bookings.forEach(b => b.tickets.forEach(t => lines.push([b.ref, t.ticketId, t.seat, TIERS[t.tier].label, t.price, b.customer.first, b.customer.last, b.customer.phone, b.customer.email, b.customer.role, b.customer.student, statusLabel(b), b.paymentId || '', b.createdAt, t.checkedInAt || ''])));
    const csv = lines.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `winter-vespers-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  function bindAdmin() {
    $('#pinForm').addEventListener('submit', e => {
      e.preventDefault();
      if ($('#pinInput').value === STAFF_PIN) { staffOpen = true; sessionStorage.setItem('wv_staff', '1'); $('#pinInput').value = ''; renderAdmin(); }
      else { $('#pinInput').classList.add('bad'); toast('Wrong PIN.'); }
    });
    $('#pinInput').addEventListener('input', e => e.target.classList.remove('bad'));
    $('#lockBtn').onclick = () => { staffOpen = false; sessionStorage.removeItem('wv_staff'); stopScan(); renderAdmin(); };
    $('#ciForm').addEventListener('submit', e => { e.preventDefault(); doCheckIn($('#ciInput').value); });
    $('#scanBtn').onclick = () => (camStream ? stopScan() : startScan());
    $('#bkSearch').addEventListener('input', e => { adminQuery = e.target.value; renderAdmin(); });
    $('#csvBtn').onclick = exportCSV;
    $('#bkBody').addEventListener('click', async e => {
      const tr = e.target.closest('.bk-row'); if (!tr) return;
      resultCard('booking', await DB.byRef(tr.dataset.ref));
      $('#ciResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('#ciResult').addEventListener('click', async e => {
      const ci = e.target.closest('[data-checkin]'), un = e.target.closest('[data-undo]');
      if (ci) doCheckIn(ci.dataset.checkin);
      if (un) { const r = await DB.undoCheckIn(un.dataset.undo); if (r) { resultCard('booking', r.booking); renderAdmin(); } }
    });
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
  const VIEWS = ['home', 'seats', 'checkout', 'tickets', 'admin'];
  function go(v) { if (location.hash === '#' + v) route(); else location.hash = v; }
  function route() {
    let v = location.hash.slice(1) || 'home';
    let anchor = null;
    if (!VIEWS.includes(v)) { anchor = v; v = 'home'; }
    if (v === 'checkout' && !picked.size) { v = 'seats'; history.replaceState(null, '', '#seats'); toast('Pick at least one seat first.'); }
    const cur = $('.view.active');
    const next = $('#view-' + v);
    if (cur !== next) { cur?.classList.remove('active'); next.classList.add('active'); }
    $$('.nav-links a, #mobileMenu a').forEach(a => a.classList.toggle('on', a.dataset.go === v));
    if (v === 'checkout') renderCheckout();
    if (v === 'tickets') renderTickets();
    if (v === 'admin') renderAdmin(); else if (typeof stopScan === 'function' && camStream) stopScan();
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
     HOME — interactive extras
     ========================================================= */
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function heroSlideshow() {
    const slides = $$('#heroSlides .hero-bg'), dots = $('#heroDots');
    if (slides.length < 2) return;
    const SLIDE_MS = 6500;
    dots.style.setProperty('--slide', SLIDE_MS + 'ms');
    dots.innerHTML = slides.map((_, i) => `<button aria-label="Photo ${i + 1}"></button>`).join('') + '<span class="cap"></span>';
    const btns = $$('button', dots), cap = $('.cap', dots);
    let i = 0, timer;
    const show = n => {
      i = (n + slides.length) % slides.length;
      slides.forEach((s, k) => s.classList.toggle('on', k === i));
      btns.forEach((b, k) => { b.classList.toggle('done', k < i); b.classList.remove('on'); });
      void dots.offsetWidth; btns[i].classList.add('on');
      cap.style.opacity = 0; setTimeout(() => { cap.textContent = slides[i].dataset.cap || ''; cap.style.opacity = 1; }, 300);
      clearTimeout(timer); timer = setTimeout(() => show(i + 1), SLIDE_MS);
    };
    btns.forEach((b, k) => b.addEventListener('click', e => { e.stopPropagation(); show(k); }));
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else show(i); });
    show(0);
  }

  function heroPlay() {
    const hero = $('.hero'), inner = $('.hero-inner'), orns = $('.ornaments');
    // ornaments jingle when tapped
    $$('.orn i').forEach(o => o.addEventListener('click', e => {
      e.stopPropagation();
      const orn = o.parentElement;
      orn.classList.remove('jingle'); void orn.offsetWidth; orn.classList.add('jingle');
      const r = o.getBoundingClientRect();
      window.Snow && Snow.burstAt(r.left + r.width / 2, r.top + r.height / 2);
    }));
    // click anywhere on the hero (not on buttons) for a puff of snow
    hero.addEventListener('click', e => {
      if (e.target.closest('a,button')) return;
      window.Snow && Snow.burstAt(e.clientX, e.clientY);
    });
    // gentle parallax with the mouse
    if (reduceMotion || matchMedia('(hover: none)').matches) return;
    hero.addEventListener('pointermove', e => {
      const x = e.clientX / innerWidth - .5, y = e.clientY / innerHeight - .5;
      inner.style.transform = `translate(${x * -14}px, ${y * -10}px)`;
      orns.style.transform = `translate(${x * 22}px, ${y * 8}px)`;
    });
    hero.addEventListener('pointerleave', () => { inner.style.transform = ''; orns.style.transform = ''; });
  }

  /* moments strip: auto-scrolls, drag/swipe to browse */
  function momentsStrip() {
    const wrap = $('#marquee'), track = $('#marqueeTrack');
    const items = $$('.g').map(g => ({ src: $('img', g).getAttribute('src'), alt: $('img', g).alt, cap: $('figcaption', g).textContent }));
    const html = items.map((it, k) => `<figure class="m-item" data-i="${k}"><img src="${it.src}" alt="${esc(it.alt)}" loading="lazy" draggable="false" /><span>${esc(it.cap)}</span></figure>`).join('');
    track.innerHTML = html + html;          // doubled for a seamless loop
    let x = 0, speed = reduceMotion ? 0 : 0.45, hover = false, drag = null, moved = false, last = performance.now();
    const half = () => track.scrollWidth / 2;
    (function tick(now) {
      const dt = Math.min(48, now - last); last = now;
      if (!drag && !hover) x -= speed * dt / 16;
      const h = half(); if (h) { if (x <= -h) x += h; if (x > 0) x -= h; }
      track.style.transform = `translateX(${x}px)`;
      requestAnimationFrame(tick);
    })(last);
    wrap.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hover = true; });
    wrap.addEventListener('pointerleave', () => { hover = false; });
    wrap.addEventListener('pointerdown', e => { drag = { sx: e.clientX, x }; moved = false; wrap.setPointerCapture(e.pointerId); wrap.classList.add('dragging'); });
    wrap.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      if (Math.abs(dx) > 5) moved = true;
      x = drag.x + dx;
    });
    const end = e => {
      if (!drag) return;
      wrap.classList.remove('dragging'); drag = null;
      if (!moved) {          // a tap opens the photo
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.m-item');
        if (el) openLightbox(items, +el.dataset.i);
      }
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', () => { drag = null; wrap.classList.remove('dragging'); });
  }

  /* gallery: filters + 3D tilt + lightbox */
  function galleryPlay() {
    const figs = $$('.g');
    $$('#gFilters button').forEach(b => b.addEventListener('click', () => {
      $$('#gFilters button').forEach(x => x.classList.toggle('on', x === b));
      const cat = b.dataset.cat;
      figs.forEach((g, k) => {
        const show = cat === 'all' || g.dataset.cat === cat;
        g.classList.toggle('out', !show);
        g.classList.remove('pop');
        if (show) { g.classList.add('in'); g.style.animationDelay = (k % 6) * 0.05 + 's'; void g.offsetWidth; g.classList.add('pop'); }
      });
    }));
    figs.forEach(g => {
      g.addEventListener('pointermove', e => {
        if (e.pointerType !== 'mouse') return;
        const r = g.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        g.style.setProperty('--ry', ((px - .5) * 10) + 'deg');
        g.style.setProperty('--rx', ((.5 - py) * 10) + 'deg');
        g.style.setProperty('--mx', px * 100 + '%');
        g.style.setProperty('--my', py * 100 + '%');
      });
      g.addEventListener('pointerleave', () => { g.style.setProperty('--rx', 0); g.style.setProperty('--ry', 0); });
      g.addEventListener('click', () => {
        const vis = figs.filter(f => !f.classList.contains('out'));
        const list = vis.map(f => ({ src: $('img', f).getAttribute('src'), alt: $('img', f).alt, cap: $('figcaption', f).textContent }));
        openLightbox(list, vis.indexOf(g));
      });
    });
  }

  let lbList = [], lbIdx = 0;
  function openLightbox(list, i) {
    lbList = list; const lb = $('#lightbox');
    $('.lb-thumbs', lb).innerHTML = list.map((it, k) => `<button data-k="${k}" aria-label="${esc(it.cap)}"><img src="${it.src}" alt="" /></button>`).join('');
    lb.hidden = false; document.body.style.overflow = 'hidden';
    lbShow(i, 0);
  }
  function lbShow(i, dir) {
    const lb = $('#lightbox'), img = $('.lb-fig img', lb);
    lbIdx = (i + lbList.length) % lbList.length;
    const it = lbList[lbIdx];
    img.classList.remove('slide-l', 'slide-r'); void img.offsetWidth;
    if (dir) img.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
    img.src = it.src; img.alt = it.alt;
    $('.lb-cap', lb).textContent = it.cap;
    $('.lb-count', lb).textContent = `${lbIdx + 1} / ${lbList.length}`;
    $$('.lb-thumbs button', lb).forEach((b, k) => b.classList.toggle('on', k === lbIdx));
    $('.lb-thumbs button.on', lb)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  function closeLightbox() { $('#lightbox').hidden = true; document.body.style.overflow = ''; }
  function bindLightbox() {
    const lb = $('#lightbox');
    $('.lb-close', lb).onclick = closeLightbox;
    $('.lb-prev', lb).onclick = e => { e.stopPropagation(); lbShow(lbIdx - 1, -1); };
    $('.lb-next', lb).onclick = e => { e.stopPropagation(); lbShow(lbIdx + 1, 1); };
    $('.lb-thumbs', lb).addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) { e.stopPropagation(); lbShow(+b.dataset.k, +b.dataset.k > lbIdx ? 1 : -1); } });
    lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
    addEventListener('keydown', e => {
      if (lb.hidden) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') lbShow(lbIdx + 1, 1);
      if (e.key === 'ArrowLeft') lbShow(lbIdx - 1, -1);
    });
    let sx = null;                              // swipe on phones
    lb.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', e => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 50) lbShow(lbIdx + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    });
  }

  /* =========================================================
     INIT
     ========================================================= */
  async function init() {
    bookings = await DB.all();
    buildHall();
    bindAdmin();
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
      const cp = e.target.closest('[data-copy]');
      if (cp) { navigator.clipboard?.writeText(cp.dataset.copy).then(() => toast(`Copied <b>${cp.dataset.copy}</b>`), () => toast(cp.dataset.copy)); }
    });
    addEventListener('hashchange', route);
    // phone menu
    const menu = $('#mobileMenu'), menuBtn = $('#menuBtn');
    const setMenu = open => { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', open); menuBtn.classList.toggle('open', open); document.body.classList.toggle('menu-open', open); };
    menuBtn.onclick = e => { e.stopPropagation(); setMenu(menu.hidden); };
    menu.addEventListener('click', e => { if (e.target.closest('a') || e.target === menu) setMenu(false); });
    addEventListener('hashchange', () => setMenu(false));
    addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
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
    $('#resetDemo').onclick = async () => { if (confirm('Clear ALL demo bookings and tickets on this device?')) { await DB.reset(); localStorage.removeItem('wv_my_refs'); location.hash = 'home'; location.reload(); } };
    $('#findForm').addEventListener('submit', findBooking);

    // home extras
    heroSlideshow(); heroPlay(); momentsStrip(); galleryPlay(); bindLightbox();

    // hero reveals straight away
    requestAnimationFrame(() => $$('.hero .reveal').forEach(el => el.classList.add('in')));
    route();
    renderTickets();   // nav badge count
  }

  init();
})();
