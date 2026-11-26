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
    dateISO: '2026-12-18T16:30:00+05:30',
    day: 'Friday', dayNum: 18, month: 'December', time: '4:30 PM'
  };
  // Seat plan + prices live in js/hall-plan.js (shared with the server).
  const COINS = { vip: 'assets/img/coin-vip.png', gold: 'assets/img/coin-gold.png', silver: 'assets/img/coin-silver.png', bronze: 'assets/img/coin-bronze.png' };
  const TIERS = Object.fromEntries(Object.entries(window.HALL_PLAN.TIERS).map(([k, t]) => [k, { ...t, coin: COINS[k] }]));
  const TIER_KEYS = Object.keys(TIERS);           // vip, gold, silver, bronze
  const MAX_SEATS = 10;
  const HOLD_SECONDS = 10 * 60;
  const DEMO_TAKEN_RATIO = 0.14;   // demo only: pretend some seats are already sold

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
  let liveTaken = [];                       // seats sold/held on the server (live mode)
  let staffBookings = [];                   // staff page list
  let holdEnd = null, holdTimer = null;
  let justPaidRef = null;

  /* =========================================================
     HALL PLAN (SVG)
     ========================================================= */
  const hall = $('#hall');
  const PLAN = window.HALL_PLAN;
  let floor = 'ground';                     // which floor the map is showing
  const floorLayers = {};

  function buildHall() {
    hall.innerHTML = '';
    const defs = svgEl('defs', {}, hall);
    defs.innerHTML = `
      <radialGradient id="stageGlow" cx="50%" cy="0%" r="70%">
        <stop offset="0%" stop-color="#f6dc93" stop-opacity=".45"/><stop offset="100%" stop-color="#f6dc93" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="stageFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7c0a1c"/><stop offset="100%" stop-color="#3a0610"/>
      </linearGradient>`;
    const rand = seeded(20261218);
    const booked = new Set(Backend.live ? liveTaken : bookings.flatMap(b => b.tickets.map(t => t.seat)));
    const seatLayers = {};

    Object.entries(PLAN.FLOORS).forEach(([fid, F]) => {
      const layer = svgEl('g', { class: 'floor-layer', 'data-floor': fid }, hall);
      floorLayers[fid] = layer;
      svgEl('rect', { x: 6, y: 6, width: F.w - 12, height: F.h - 12, rx: 26, class: 'hall-wall' }, layer);
      const st = F.stage;
      if (st.kind === 'rail') {
        svgEl('rect', { x: st.x, y: st.y, width: st.w, height: st.h, rx: 14, class: 'rail' }, layer);
      } else {
        svgEl('ellipse', { cx: st.x + st.w / 2, cy: st.y, rx: st.w * .62, ry: st.h * 1.4, fill: 'url(#stageGlow)', class: 'stage-glow' }, layer);
        svgEl('rect', { x: st.x, y: st.y, width: st.w, height: st.h, rx: 18, fill: 'url(#stageFill)', stroke: 'rgba(246,220,147,.55)', 'stroke-width': 1.5 }, layer);
      }
      const sl = svgEl('text', { x: st.x + st.w / 2, y: st.y + st.h / 2 + (st.kind === 'rail' ? 5 : 9), 'text-anchor': 'middle', class: st.kind === 'rail' ? 'rail-label' : 'stage-label' }, layer);
      sl.textContent = st.label;
      F.boxes.forEach(b => {
        svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 14, class: `box ${b.kind}` }, layer);
        const lines = b.label.split(' & ').length > 1 ? [b.label.split(' & ')[0] + ' &', b.label.split(' & ')[1]] : [b.label];
        lines.forEach((ln, i) => {
          const t = svgEl('text', { x: b.x + b.w / 2, y: b.y + b.h / 2 + 5 + (i - (lines.length - 1) / 2) * 18, 'text-anchor': 'middle', class: 'box-label' }, layer);
          t.textContent = ln;
        });
      });
      F.notes.forEach(n => {
        const t = svgEl('text', { x: n.x, y: n.y, 'text-anchor': 'middle', class: `tier-note ${n.tier}` }, layer);
        t.textContent = n.text;
      });
      seatLayers[fid] = svgEl('g', { class: 'seat-layer' }, layer);
    });

    // row letters on the outside of the left-most / right-most blocks
    PLAN.BLOCKS.forEach(b => {
      if (!b.side) return;
      [...b.rows].forEach(r => {
        const row = (b.prefix || '') + r;
        const edge = PLAN.seats.find(p => p.block === b.id && p.row === row && (b.side === 'left' ? p.num === b.first : p.num === b.first + b.seats - 1));
        const t = svgEl('text', { x: edge.x + (b.side === 'left' ? -1 : 1) * PLAN.SX * 1.05, y: edge.y + 5, 'text-anchor': 'middle', class: 'row-lbl' }, floorLayers[b.floor]);
        t.textContent = row;
      });
    });

    // more row letters so you always know your row when zoomed in:
    // ground floor: in the centre aisle · gallery: beside every block
    const rowLetter = (floor, x, y, txt, cls = 'row-lbl') => { const t = svgEl('text', { x, y: y + 6, 'text-anchor': 'middle', class: cls }, floorLayers[floor]); t.textContent = txt; };
    const gL = PLAN.BLOCKS.find(b => b.id === 'gL'), gR = PLAN.BLOCKS.find(b => b.id === 'gR');
    const aisleX = (gL.x + (gL.seats - 1) * PLAN.SX + gR.x) / 2;
    PLAN.seats.filter(p => p.block === 'gL' && p.num === 1).forEach(p => rowLetter('ground', aisleX, p.y, p.row, 'row-lbl aisle'));
    PLAN.BLOCKS.filter(b => b.floor === 'gallery' && !b.side).forEach(b =>
      PLAN.seats.filter(p => p.block === b.id && p.num === b.first).forEach(p => rowLetter('gallery', p.x - PLAN.SX * 1.05, p.y, p.row)));

    PLAN.seats.forEach(p => {
      const taken = booked.has(p.id) || (!Backend.live && rand() < DEMO_TAKEN_RATIO);
      const seat = { ...p, taken, el: null };
      const g = svgEl('g', {
        class: `seat ${p.tier}${taken ? ' taken' : ''}`,
        transform: `translate(${p.x} ${p.y})`,
        'data-id': p.id, tabindex: taken ? -1 : 0, role: 'button',
        'aria-label': `Row ${p.row} seat ${p.num}, ${TIERS[p.tier].label}, ${rs(TIERS[p.tier].price)}${taken ? ', taken' : ''}`
      }, seatLayers[p.floor]);
      svgEl('rect', { x: -15, y: -16, width: 30, height: 32, fill: 'transparent', class: 's-hit' }, g);      // whole cell is clickable
      const inner = svgEl('g', { class: 'seat-in' }, g);                                                    // CSS scales this
      svgEl('rect', { x: -13, y: -11, width: 26, height: 26, rx: 6, class: 's-back' }, inner);             // soft shadow
      svgEl('rect', { x: -13, y: -13, width: 26, height: 26, rx: 6, class: 's-body' }, inner);             // big square seat
      svgEl('path', { d: 'M-6 -6 L6 6 M6 -6 L-6 6', class: 's-x' }, inner);
      svgEl('path', { d: 'M-7 0 L-2.5 4.5 L7 -5', class: 's-check' }, inner);
      const n = svgEl('text', { x: 0, y: 4.6, 'text-anchor': 'middle', class: 's-num' }, inner);
      n.textContent = p.num;
      seat.el = g;
      seats.set(p.id, seat);
    });
  }

  /** show one floor of the hall */
  function setFloor(f, { instant = false, keepView = false } = {}) {
    floor = f;
    Object.entries(floorLayers).forEach(([k, g]) => { g.style.display = k === f ? '' : 'none'; });
    BASE.w = PLAN.FLOORS[f].w; BASE.h = PLAN.FLOORS[f].h;
    mapWrap.style.setProperty('--hall-ar', `${BASE.w} / ${BASE.h}`);
    if (mini) mini.style.aspectRatio = `${BASE.w} / ${BASE.h}`;
    $$('#floorTabs [data-floor]').forEach(b => b.classList.toggle('on', b.dataset.floor === f));
    placeControls();
    const fj = $('#floorJump');
    if (fj) {
      fj.classList.toggle('down', f === 'gallery');
      fj.innerHTML = f === 'ground'
        ? `<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg><span><b>Gallery upstairs</b><small>${galleryLeft()} Gold seats</small></span>`
        : `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg><span><b>Ground floor</b><small>VIP · Gold · Silver · Bronze</small></span>`;
    }
    if (keepView) return;
    hall.setAttribute('viewBox', `0 0 ${BASE.w} ${BASE.h}`);
    openView(instant);
  }
  /* computers: Floor buttons + seat colours sit inside the map, in the empty corners beside the stage */
  function placeControls() {
    const inMap = false;   // controls live in the side panel (computers) / above the map (phones)
    document.body.classList.toggle('ctl-in-map', inMap);
    const legend = $('#legend'), tabs = $('#floorTabs');
    if (inMap) { $('#ovLegend').appendChild(legend); $('#ovFloor').appendChild(tabs); }
    else { $('.legend-box').appendChild(legend); $('.floor-box').appendChild(tabs); }
    const F = PLAN.FLOORS[floor], st = F.stage, pad = 26, top = 16;
    const h = F.notes[0].y - 34 - top;
    const pct = (v, of) => (v / of * 100) + '%';
    const set = (el, x, w) => Object.assign(el.style, { left: pct(x, F.w), width: pct(w, F.w), top: pct(top, F.h), height: pct(h, F.h) });
    set($('#ovLegend'), pad, st.x - 2 * pad);
    set($('#ovFloor'), st.x + st.w + pad, F.w - (st.x + st.w) - 2 * pad);
  }
  const galleryLeft = () => [...seats.values()].filter(s => s.floor === 'gallery' && !s.taken).length;

  /** readable start: zoomed so seats are big, at the front rows, centred on the middle aisle */
  function openView(instant) {
    if (!mapWrap.clientWidth) return;
    $$('#legend [data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    if (!fitMode()) { view.z = 1; view.cx = BASE.w / 2; view.cy = BASE.h / 2; return instant ? applyView() : animateView(); }
    view.z = tapZoom();
    view.cx = floor === 'gallery' ? 0 : BASE.w / 2;   // gallery: start at the first full block (clamped to the left edge)
    const stg = PLAN.FLOORS[floor].stage;
    view.cy = stg.y + stg.h * .4 + viewSize().h / 2;
    $$('#legend [data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    instant ? applyView() : animateView();
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
      : `<b>${seat.floor === 'gallery' ? 'Gallery · ' : ''}Row ${seat.row} · Seat ${seat.num}</b><span class="t-${seat.tier}">${t.label}</span> · ${rs(t.price)}`;
    tip.style.left = (r.left + r.width / 2 - w.left + mapWrap.scrollLeft) + 'px';
    tip.style.top = (r.top - w.top + mapWrap.scrollTop) + 'px';
    tip.classList.add('show');
  }
  const hideTip = () => tip.classList.remove('show');

  /* zoom & pan via viewBox */
  const BASE = { w: PLAN.FLOORS.ground.w, h: PLAN.FLOORS.ground.h };   // changes with the floor
  const view = { z: 1, cx: BASE.w / 2, cy: BASE.h / 2 };
  // On phones the map sits in a tall frame, so the visible area follows the frame's shape.
  // phones/tablets: the map is a window we zoom/drag inside. Computers: the whole floor, fixed (zoom only with +).
  const fitMode = () => matchMedia('(max-width: 1024px)').matches;
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
    drawMini();
  }
  function zoomTo(z, cx, cy) {
    view.z = Math.min(6, Math.max(1, z));
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
      drawMini();
      if (k < 1) animRaf = requestAnimationFrame(step); else applyView();
    })(t0);
  }

  // screen point -> hall (SVG) coordinates
  function toHall(clientX, clientY) {
    const pt = hall.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(hall.getScreenCTM().inverse());
  }
  // on small screens seats are tiny when the whole hall is shown, so a tap zooms in first
  // seat size on screen right now (px)
  const seatPx = () => PLAN.SX * hall.getBoundingClientRect().width / hall.viewBox.baseVal.width;
  const smallScreen = () => seatPx() < 24;      // too small to tap reliably: first tap zooms in
  // zoom where each seat square is ~36px on screen (Regal-style, easy to read and tap)
  const SEAT_PX = 38;
  const tapZoom = () => Math.min(6, Math.max(1, SEAT_PX * BASE.w / (PLAN.SX * Math.max(280, mapWrap.clientWidth))));

  /* mini map (phones): where you are in the hall; tap/drag it to jump */
  const mini = document.getElementById('minimap');
  const MINI_COL = { vip: '#a970ff', gold: '#e7bd5a', silver: '#cdd6e2', bronze: '#c47f4e' };
  function drawMini() {
    if (!mini || !mapWrap.classList.contains('zoomed')) return;
    const dpr = Math.min(2, devicePixelRatio || 1), cw = mini.clientWidth, ch = mini.clientHeight;
    if (!cw) return;
    if (mini.width !== cw * dpr) { mini.width = cw * dpr; mini.height = ch * dpr; }
    const c = mini.getContext('2d'), k = cw / BASE.w;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cw, ch);
    const stg = PLAN.FLOORS[floor].stage;
    c.fillStyle = 'rgba(246,220,147,.55)'; c.fillRect(stg.x * k, stg.y * k, stg.w * k, Math.max(3, stg.h * k));   // stage
    seats.forEach(st => {
      if (st.floor !== floor) return;
      c.fillStyle = picked.has(st.id) ? '#34d399' : st.taken ? '#e8203f' : MINI_COL[st.tier];
      c.fillRect(st.x * k - 1, st.y * k - 1, 2, 2);
    });
    const vb = hall.viewBox.baseVal;
    c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    c.strokeRect(Math.max(.75, vb.x * k), Math.max(.75, vb.y * k), Math.min(cw - 1.5, vb.width * k), Math.min(ch - 1.5, vb.height * k));
  }
  function bindMini() {
    if (!mini) return;
    mini.style.aspectRatio = `${BASE.w} / ${BASE.h}`;
    let down = false;
    const move = e => {
      const r = mini.getBoundingClientRect();
      view.cx = (e.clientX - r.left) / r.width * BASE.w;
      view.cy = (e.clientY - r.top) / r.height * BASE.h;
      applyView();
    };
    mini.addEventListener('pointerdown', e => { e.stopPropagation(); down = true; mini.setPointerCapture(e.pointerId); move(e); });
    mini.addEventListener('pointermove', e => { if (down) { e.stopPropagation(); move(e); } });
    mini.addEventListener('pointerup', e => { down = false; e.stopPropagation(); });
    mini.addEventListener('click', e => e.stopPropagation());
  }
  /* phones open the seat map already zoomed in at the front of the hall, seats ~30px */
  let phoneStarted = false;
  function phoneStart() {
    if (phoneStarted || !mapWrap.clientWidth) return;
    phoneStarted = true;
    openView(true);
  }

  function bindMap() {
    bindMini();
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
        view.z = Math.min(6, Math.max(1, pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
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
    hall.addEventListener('focusin', e => { if (matchMedia('(hover: none)').matches) return; const g = e.target.closest('.seat'); if (g) showTip(seats.get(g.dataset.id)); });
    hall.addEventListener('focusout', hideTip);
    hall.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomTo(view.z * (e.deltaY < 0 ? 1.25 : 0.8));
    }, { passive: false });

    $('#zoomIn').onclick = () => zoomTo(view.z * 1.35);
    $('#zoomOut').onclick = () => zoomTo(view.z / 1.35);
    $('#zoomReset').onclick = () => zoomTo(1, BASE.w / 2, BASE.h / 2);
    $$('#floorTabs [data-floor]').forEach(b => b.addEventListener('click', () => { setFilter(null, { stay: true }); setFloor(b.dataset.floor); }));

    // legend filters
    $$('#legend [data-filter]').forEach(b => b.addEventListener('click', () => {
      const f = b.dataset.filter;
      setFilter(f === 'all' || b.classList.contains('active') ? null : f);
    }));
    $('#floorJump').addEventListener('click', () => { setFilter(null, { stay: true }); setFloor(floor === 'ground' ? 'gallery' : 'ground'); });
    let wasFit = fitMode();
    addEventListener('resize', () => { clearTimeout(bindMap._r); bindMap._r = setTimeout(() => { if (fitMode() !== wasFit) { wasFit = fitMode(); placeControls(); openView(true); } else applyView(); }, 120); });
  }

  function setFilter(tier, { stay = false } = {}) {
    $$('#legend [data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === (tier || 'all')));
    hall.classList.toggle('filtering', !!tier);
    seats.forEach(s => s.el.classList.toggle('hl', s.tier === tier));
    if (stay) return;
    if (tier) {
      // jump to the floor that has this tier (Gold is on both: stay if already there)
      const here = [...seats.values()].some(s => s.tier === tier && s.floor === floor);
      if (!here) setFloor([...seats.values()].find(s => s.tier === tier).floor, { instant: true });
      const list = [...seats.values()].filter(s => s.tier === tier && s.floor === floor);
      const xs = list.map(s => s.x), ys = list.map(s => s.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      if (fitMode()) {                                     // phones: big seats, starting at the tier's front row
        view.z = tapZoom();
        zoomTo(view.z, cx, Math.min(...ys) - 50 + viewSize().h / 2);
      }
      $('#bestTier').value = tier;
    } else if (fitMode()) openView();
  }

  /* best available seats together: front rows first, then closest to the middle of the hall */
  function bestSeats(tier, qty) {
    let best = null;
    const groups = {};
    seats.forEach(s => { if (s.tier === tier) (groups[s.block + '|' + s.row] ||= []).push(s); });
    Object.values(groups).forEach(list => {
      list.sort((a, b) => a.num - b.num);
      const F = PLAN.FLOORS[list[0].floor], mid = F.w / 2;
      for (let i = 0; i + qty <= list.length; i++) {
        const run = list.slice(i, i + qty);
        if (run.some(s => s.taken || picked.has(s.id))) continue;
        const cx = (run[0].x + run[run.length - 1].x) / 2;
        // distance from stage dominates; ground beats gallery for the same tier
        const score = (run[0].y - F.stage.y) / PLAN.SY * 4 + Math.abs(cx - mid) / PLAN.SX * 0.35 + (run[0].floor === 'gallery' ? 30 : 0);
        if (!best || score < best.score) best = { score, run };
      }
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
    const by = Object.fromEntries(TIER_KEYS.map(k => [k, []]));
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
    drawMini();
    followSide();
  }

  /* computers: the side panel follows your picks: scroll down to "Your seats" when you pick,
     back to the top (Floor, Quick pick) when everything is cleared */
  let lastPickCount = 0;
  function followSide() {
    const n = picked.size, side = $('.seat-side');
    if (n === lastPickCount || !side || fitMode()) { lastPickCount = n; return; }
    const target = n === 0 ? 0 : side.scrollHeight;
    lastPickCount = n;
    requestAnimationFrame(() => side.scrollTo({ top: target, behavior: 'smooth' }));
  }

  /* seats-left counters on tier cards */
  function updateAvailability() {
    const left = Object.fromEntries(TIER_KEYS.map(k => [k, 0]));
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
    $('#payLbl').textContent = payMethod() === 'bank' ? `Reserve seats · ${rs(total)}` : `Pay ${rs(total)} with PayHere`;
  }

  function validate() {
    const f = $('#coForm');
    let ok = true;
    ['first', 'last', 'email', 'phone'].forEach(n => {
      const i = f.elements[n];
      let bad = !i.value.trim();
      if (n === 'email') bad = !!i.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.value.trim());   // optional, but must look right if given
      if (n === 'phone' && !bad) bad = !/^(?:\+?94|0)?7\d{8}$/.test(i.value.replace(/[\s-]/g, ''));            // Sri Lankan mobile
      if (n === 'phone' && !bad) bad = i.value.replace(/\D/g, '').length < 9;
      i.classList.toggle('bad', bad);
      if (bad) ok = false;
    });
    const err = $('#formError');
    if (!ok) { err.textContent = f.elements.phone.classList.contains('bad') ? 'Please enter a Sri Lankan mobile number (e.g. 077 123 4567). Your tickets are sent there by SMS.' : 'Please check the highlighted details.'; err.hidden = false; return false; }
    if (!f.elements.agree.checked) { err.textContent = 'Please tick the box to agree to the ticket terms.'; err.hidden = false; return false; }
    err.hidden = true; return true;
  }

  function markTaken(ids) {
    ids.forEach(id => { const s = seats.get(id); if (!s) return; s.taken = true; s.el.classList.add('taken'); s.el.classList.remove('picked'); picked.delete(id); });
  }

  // seats freed or sold elsewhere since the page loaded (live mode)
  function syncTaken(serverTaken) {
    const set = new Set(serverTaken);
    let lost = [];
    seats.forEach(s => {
      const now = set.has(s.id);
      if (now && !s.taken) {
        s.taken = true; s.el.classList.add('taken');
        if (picked.has(s.id)) { picked.delete(s.id); s.el.classList.remove('picked'); lost.push(s.id); }
      } else if (!now && s.taken) { s.taken = false; s.el.classList.remove('taken'); }
    });
    if (lost.length) toast(`Sorry, ${lost.join(', ')} ${lost.length > 1 ? 'were' : 'was'} just booked by someone else.`);
    updateSummary(); updateAvailability();
  }

  function finishBooking(booking) {
    bookings = [booking, ...bookings.filter(b => b.ref !== booking.ref)];
    myRefs = [booking.ref, ...myRefs.filter(r => r !== booking.ref)]; store.set('wv_my_refs', myRefs);
    markTaken(booking.tickets.map(t => t.seat));
    updateSummary(); updateAvailability();
    $('#coForm').reset();
    justPaidRef = booking.ref;
    $('#payModal').hidden = true;
    go('tickets');
    window.Snow && Snow.on && Snow.burst();
  }

  async function pay() {
    if (!picked.size) { go('seats'); return; }
    if (!validate()) return;
    const f = $('#coForm').elements;
    const customer = { first: f.first.value.trim(), last: f.last.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), role: f.role.value, student: f.student.value.trim() };
    const sortedSeats = [...picked.values()].sort((a, b) => a.row.localeCompare(b.row) || a.num - b.num);
    const modal = $('#payModal'), title = $('#payModalTitle'), text = $('#payModalText');
    const show = (t, x) => { title.textContent = t; text.textContent = x; modal.hidden = false; };

    if (Backend.live && payMethod() === 'bank') return payBank(customer, sortedSeats, show);
    if (Backend.live) return payLive(customer, sortedSeats, show);

    // ---------- DEMO (no server yet) ----------
    const { total } = totals();
    const ref = DB.newRef();
    const booking = {
      ref, status: 'paid-demo', paymentId: null, amount: total, currency: 'LKR', createdAt: new Date().toISOString(), customer,
      tickets: sortedSeats.map(s => ({ ticketId: `${ref}-${s.id}`, seat: s.id, row: s.row, num: s.num, tier: s.tier, price: TIERS[s.tier].price, checkedInAt: null }))
    };
    show('Contacting PayHere…', 'Demo mode: no money is taken.');
    try {
      await Payment.pay(booking);
      show('Payment confirmed', `Recording booking ${ref}…`);
      await DB.create(booking);
      await new Promise(r => setTimeout(r, 700));
      finishBooking(booking);
    } catch (err) {
      modal.hidden = true;
      bookings = await DB.all();
      markTaken(bookings.flatMap(b => b.tickets.map(t => t.seat)));
      updateSummary(); updateAvailability();
      toast('Booking not completed: ' + err.message);
    }
  }

  // which way to pay: 'bank' or 'payhere' (from what the server has switched on + what the buyer picked)
  function payMethod() {
    if (!Backend.live) return 'payhere';
    const m = Backend.methods;
    if (m.length === 1) return m[0];
    return $('#coForm').elements.method?.value || m[0];
  }

  // ---------- BANK TRANSFER: server holds the seats, buyer transfers, staff approve ----------
  async function payBank(customer, sortedSeats, show) {
    show('Reserving your seats…', 'One moment.');
    try {
      const { booking } = await Backend.createTransfer(customer, sortedSeats.map(s => s.id));
      bookings = [booking, ...bookings.filter(b => b.ref !== booking.ref)];
      myRefs = [booking.ref, ...myRefs.filter(r => r !== booking.ref)]; store.set('wv_my_refs', myRefs);
      markTaken(booking.tickets.map(t => t.seat));
      updateSummary(); updateAvailability();
      $('#coForm').reset();
      $('#payModal').hidden = true;
      openPay(booking.ref);
    } catch (e) {
      $('#payModal').hidden = true;
      if (e.data?.error === 'SEAT_TAKEN') { markTaken(e.data.taken || []); updateSummary(); updateAvailability(); toast(e.data.message); go('seats'); }
      else toast(e.message || 'Could not reserve your seats. Please try again.');
    }
  }

  // ---------- LIVE: server reserves + signs, PayHere takes the money, server confirms ----------
  async function payLive(customer, sortedSeats, show) {
    const modal = $('#payModal');
    show('Reserving your seats…', 'One moment.');
    let order;
    try {
      [order] = await Promise.all([Backend.createOrder(customer, sortedSeats.map(s => s.id)), Payment.loadSDK()]);
    } catch (e) {
      modal.hidden = true;
      if (e.data?.error === 'SEAT_TAKEN') { markTaken(e.data.taken || []); updateSummary(); updateAvailability(); toast(e.data.message); go('seats'); }
      else toast(e.message || 'Could not start the payment. Please try again.');
      return;
    }
    const ref = order.booking.ref;
    show('Pay in the PayHere window', `Booking ${ref} · ${rs(order.booking.amount)}${Backend.sandbox ? ' · TEST MODE: use a PayHere test card' : ''}`);
    try {
      await Payment.popup(order.payment);
    } catch (e) {
      modal.hidden = true;
      await Backend.cancelPending(ref);                 // free the seats straight away
      toast(e.dismissed ? 'Payment cancelled. Your seats are still selected, so you can try again.' : `Payment did not go through: ${e.message}`);
      return;
    }
    show('Confirming your payment…', "PayHere is confirming with us. Please don't close this page.");
    const b = await Backend.waitForPaid(ref);
    if (b && (b.status === 'paid' || b.status === 'paid_conflict')) { finishBooking(b); return; }
    if (b && b.status === 'pending') {
      // paid, but PayHere's confirmation is slow: show it as "confirming" on the tickets page
      finishBooking(b);
      toast('Payment received. Your tickets will appear here as soon as PayHere confirms (usually under a minute).');
      return;
    }
    modal.hidden = true;
    toast('The payment was not completed. You have not been charged for this booking.');
  }

  /* =========================================================
     TICKETS
     ========================================================= */
  function qrSVG(text) {
    const qr = qrcode(0, text.length > 40 ? 'L' : 'M'); qr.addData(text); qr.make();
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
    const gallery = /^G[A-Z]/.test(t.seat);
    const qrText = t.verifyUrl                              // live: signed link to the official check page
      || (location.protocol.startsWith('http') ? `${location.origin}${location.pathname.replace(/[^/]*$/, '')}verify.html?t=${encodeURIComponent(t.ticketId)}&demo=1` : t.ticketId);
    return `
    <article class="ticket tk ${t.tier}${t.checkedInAt ? ' used' : ''}" data-no="${t.ticketId}">
      <div class="t-part t-stub tk-stub">
        ${t.tier === 'vip' ? '<div class="tk-vip-band"><svg viewBox="0 0 24 16" aria-hidden="true"><path d="M2 14 L4 4 L9 9 L12 2 L15 9 L20 4 L22 14 Z"/></svg>VIP · FRONT ROWS</div>' : ''}
        <div class="tk-tier"><img src="${tier.coin}" alt="" />${tier.label} · ${rs(tier.price)}</div>
        <div class="tk-mid">
          <div class="tk-seat"><small>Row · Seat</small><b>${t.seat}</b><span>${gallery ? 'Gallery · ' : ''}Row ${t.row} · Seat ${t.num}</span></div>
          <div class="tk-qr" title="Scan to verify">${qrSVG(qrText)}</div>
        </div>
        <div class="tk-who"><b>${esc(fullName(b))}</b><span>${t.ticketId}</span></div>
      </div>
      <div class="t-part t-main tk-main">
        <img class="tk-face" src="assets/img/ticket-face.jpg" alt="Winter Vespers 2026 · Friday 18 December 2026 · from 4:30 PM · Namal Hall" />
        <div class="tk-admit-one">${t.tier === 'vip' ? 'VIP · ' : ''}ADMIT ONE · ${t.seat}</div>
      </div>
      <div class="t-perf"></div>
      <div class="t-scissor"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg></div>
      <div class="t-admit">ADMITTED${t.checkedInAt ? `<small>${new Date(t.checkedInAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}</small>` : ''}</div>
    </article>`;
  }

  const STATUS = { 'paid-demo': 'Paid (demo)', paid: 'Paid', cash: 'Paid at office', pending: 'Confirming payment…', paid_conflict: 'Paid: needs staff check', chargedback: 'Charged back', cancelled: 'Cancelled', failed: 'Failed', expired: 'Expired', awaiting_transfer: 'Waiting for bank transfer', rejected: 'Not approved' };
  function statusLabel(b) {
    if (b.status === 'awaiting_transfer') return b.slipAt ? 'Slip received · checking' : 'Waiting for bank transfer';
    if (b.status === 'paid' && b.channel === 'bank') return 'Paid · bank transfer';
    return STATUS[b.status] || b.status;
  }
  const timeLeft = iso => {
    const ms = new Date(iso) - Date.now(); if (ms <= 0) return 'time is up';
    const h = Math.floor(ms / 36e5), m = Math.floor(ms % 36e5 / 6e4);
    return h ? `${h}h ${m}m left` : `${m} min left`;
  };

  /* copy to clipboard, with a fallback for older phones, and a ✓ on the button */
  async function copyText(btn) {
    const text = btn.dataset.copy;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch {} ta.remove();
    }
    if (!ok) { toast('Could not copy. Please write it down: ' + esc(text)); return; }
    toast(text.includes('\n') ? 'Copied all payment details.' : `Copied <b>${esc(text)}</b>`);
    const lbl = btn.querySelector('span');
    btn.classList.add('copied');
    if (lbl) { const was = lbl.textContent; lbl.textContent = 'Copied ✓'; setTimeout(() => { lbl.textContent = was; btn.classList.remove('copied'); }, 1800); }
    else setTimeout(() => btn.classList.remove('copied'), 1800);
  }

  /* ---------- PAY page: everything the buyer needs to make the transfer ---------- */
  let payRef = sessionStorage.getItem('wv_pay_ref') || null;
  function openPay(ref) { payRef = ref; sessionStorage.setItem('wv_pay_ref', ref); go('pay'); }
  const copyBtn = (v, label, big) => `<button class="copy-chip${big ? ' big' : ''}" type="button" data-copy="${esc(String(v))}" aria-label="Copy ${label}"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg><span>Copy</span></button>`;
  const deadlineTxt = iso => new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });

  function renderPay() {
    const page = $('#payPage');
    const b = bookings.find(x => x.ref === payRef);
    clearInterval(renderPay._clock); clearTimeout(renderPay._poll);
    if (!b) {
      page.innerHTML = `<div class="pay-missing"><p>We couldn't find that booking on this phone.</p><a class="btn btn-gold" href="#tickets" data-go="tickets">Go to My tickets</a></div>`;
      return;
    }
    if (isValid(b)) { justPaidRef = b.ref; go('tickets'); return; }          // already approved
    const bank = Backend.bank || {};
    const slipped = !!b.slipAt, rejected = b.status === 'rejected', expired = b.status === 'expired';
    $('#payLead').innerHTML = rejected ? 'This booking was not approved.'
      : expired ? 'The time to pay for this booking has run out.'
      : slipped ? 'Thank you! We\'ll SMS your tickets once it\'s verified.'
      : `Send <b>${rs(b.amount)}</b> to the school account, then upload the slip.`;
    const allText = `Bank: ${bank.bank}\nBranch: ${bank.branch}\nAccount name: ${bank.accountName}\nAccount number: ${bank.accountNo}\nAmount: ${b.amount}\nRemarks: ${b.ref}`;

    if (rejected || expired) {
      page.innerHTML = `<div class="pay-card pay-stop">
        <h3>${rejected ? 'Booking not approved' : 'Time ran out'}</h3>
        <p>${rejected ? esc(b.reviewNote || 'The school could not find your transfer.') : 'We did not receive a slip in time, so the seats were released.'}
          If you already transferred the money, email <a href="mailto:sunico2023@gmail.com">sunico2023@gmail.com</a> with booking number <b>${b.ref}</b> and your slip.</p>
        <a class="btn btn-gold" href="#seats" data-go="seats">Choose seats again</a></div>`;
      return;
    }

    const row = (label, value, copyVal, cls = '') => `
      <div class="px-row ${cls}"><div><small>${label}</small><b>${value}</b></div>${copyVal != null ? copyBtn(copyVal, label) : ''}</div>`;
    page.innerHTML = `
      <div class="px">
        <div class="px-steps">
          <span class="done"><i>✓</i>Seats held</span>
          <span class="${slipped ? 'done' : 'now'}"><i>${slipped ? '✓' : '2'}</i>Pay</span>
          <span class="${slipped ? 'now' : ''}"><i>3</i>${slipped ? 'Verifying' : 'Confirmed'}</span>
        </div>

        ${slipped ? `
        <div class="px-card px-ok">
          <span class="px-verify"><span class="px-ring"></span><svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg></span>
          <h3>Verifying your payment<span class="px-dots"><i>.</i><i>.</i><i>.</i></span></h3>
          <p>Slip received. Our admin will check reference <b>${b.ref}</b> in the school's bank account, then SMS your tickets to <b>${esc(b.customer.phone || 'your mobile')}</b>.</p>
          <div class="px-eta">Usually within a few hours · you can close this page</div>
          <a class="btn btn-gold btn-block" href="#tickets" data-go="tickets">My tickets</a>
        </div>` : ''}

        <div class="px-card px-bank">
          <div class="px-bank-top"><svg viewBox="0 0 24 24"><path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/></svg><span>${esc(bank.bank)} · ${esc(bank.branch)}</span></div>
          <div class="px-acc"><small>Account number</small><b class="mono">${esc(bank.accountNo)}</b>${copyBtn(bank.accountNo, 'account number', true)}</div>
          <div class="px-name"><small>Account name</small><b>${esc(bank.accountName)}</b>${copyBtn(bank.accountName, 'account name')}</div>
        </div>

        <div class="px-pair">
          <div class="px-mini"><small>Amount</small><b>${rs(b.amount)}</b>${copyBtn(b.amount, 'amount')}</div>
          <div class="px-mini px-hl"><small>Remarks</small><b class="mono">${b.ref}</b>${copyBtn(b.ref, 'booking number')}</div>
        </div>
        <button class="px-copyall" type="button" data-copy="${esc(allText)}"><span>Copy all details</span></button>

        ${slipped ? `
        <label class="px-upload ghost slip-btn"><input type="file" accept="image/*,application/pdf" data-slip="${b.ref}" hidden />
          <b>Send a different slip</b></label>` : `
        <label class="px-upload slip-btn"><input type="file" accept="image/*,application/pdf" data-slip="${b.ref}" hidden />
          <svg viewBox="0 0 24 24"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>
          <b>Upload payment slip</b></label>
        <p class="px-hold">Seats ${b.tickets.map(t => `<span class="seat-tag ${t.tier}">${t.seat}</span>`).join(' ')} held · <span class="pay-left" data-until="${b.expiresAt}">${timeLeft(b.expiresAt)}</span></p>
        <a class="px-later" href="#tickets" data-go="tickets">Pay later</a>`}

        <details class="px-help">
          <summary>Need help?</summary>
          <ol>
            <li>Open your bank app (or visit any bank).</li>
            <li>Send <b>${rs(b.amount)}</b> to the account above.</li>
            <li>Type <b>${b.ref}</b> in the remarks.</li>
            <li>Upload a screenshot of the transfer here.</li>
          </ol>
          <p>Only pay into <b>${esc(bank.accountName)}</b>. The school will never ask you to pay into another account by phone or WhatsApp.</p>
        </details>
      </div>`;
    $$('[data-slip]', page).forEach(inp => inp.addEventListener('change', () => sendSlip(inp)));
    // live countdown + notice when the school approves
    renderPay._clock = setInterval(() => { const el = $('.pay-left[data-until]'); if (el && !slipped) el.textContent = timeLeft(el.dataset.until); }, 30000);
    if (Backend.live) renderPay._poll = setTimeout(async function poll() {
      if (location.hash !== '#pay') return;
      const nb = await Backend.getBooking(b.ref).catch(() => null);
      if (nb && (nb.status !== b.status || nb.slipAt !== b.slipAt)) { bookings = bookings.map(x => x.ref === nb.ref ? nb : x); renderPay(); return; }
      renderPay._poll = setTimeout(poll, 15000);
    }, 15000);
  }

  /* My tickets: short card for a booking still waiting for its transfer */
  function bankBox(b) {
    if (b.status === 'rejected') return `
      <div class="bk-wait warn"><div><b>This booking was not approved</b>
        <p>${esc(b.reviewNote || 'The school could not find your transfer.')} The seats have been released. If you did transfer the money, email
        <a href="mailto:sunico2023@gmail.com">sunico2023@gmail.com</a> with booking number <b>${b.ref}</b> and your slip.</p></div></div>`;
    return `
      <div class="bk-wait bank-mini">
        ${b.slipAt ? '<span class="spin"></span>' : '<span class="bank-ic"><svg viewBox="0 0 24 24"><path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/></svg></span>'}
        <div><b>${b.slipAt ? 'Verifying your payment…' : `Waiting for your transfer of ${rs(b.amount)}`}</b>
          <p>Seats ${b.tickets.map(t => t.seat).join(', ')} ${b.slipAt ? 'are held for you. Our admin is checking your bank reference, and we\'ll SMS your tickets shortly.' : `are held until ${new Date(b.expiresAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} (${timeLeft(b.expiresAt)}).`}</p></div>
        <button class="btn ${b.slipAt ? 'btn-ghost' : 'btn-gold'} btn-sm" type="button" data-pay="${b.ref}">${b.slipAt ? 'View payment' : 'Pay now'}</button>
      </div>`;
  }

  const isValid = b => ['paid', 'paid-demo', 'cash'].includes(b.status);

  function renderTickets() {
    const box = $('#ticketList');
    const mine = myRefs.map(r => bookings.find(b => b.ref === r)).filter(b => b && !['cancelled', 'failed', 'expired'].includes(b.status));
    const count = mine.filter(isValid).reduce((a, b) => a + b.tickets.length, 0);
    const waiting = mine.filter(b => b.status === 'pending').length;
    const transfers = mine.filter(b => b.status === 'awaiting_transfer').length;
    $('#ticketsEmpty').hidden = count > 0 || waiting > 0 || mine.length > 0;
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
          <strong>${b.status === 'awaiting_transfer' ? `Seats held, ${esc(b.customer.first)}! Now transfer the money` : b.status === 'pending' ? `Payment received, ${esc(b.customer.first)}!` : `You're booked, ${esc(b.customer.first)}!`}</strong>
          <p>${b.tickets.length} seat${b.tickets.length > 1 ? 's' : ''} · ${rs(b.amount)} · ${statusLabel(b)}. ${b.status === 'awaiting_transfer' ? 'Use this booking number as the remarks in your transfer. ' : ''}Take a screenshot of this booking number. You'll need it, with your phone number, to find your booking again.</p>
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
          <div class="bk-meta"><span>${esc(fullName(b))}</span><span>${b.tickets.length || b.seatsCount || ''} ${b.tickets.length ? `ticket${b.tickets.length > 1 ? 's' : ''}` : ''}</span><span>${rs(b.amount)}</span><span class="${isValid(b) ? 'ok' : b.status === 'rejected' ? 'bad' : 'wait'}">${statusLabel(b)}</span><span>${fmtDate(b.createdAt)}</span></div>
        </header>
        ${isValid(b) ? `<div class="bk-tickets">${b.tickets.map(t => ticketHTML(b, t)).join('')}</div>`
          : ['awaiting_transfer', 'rejected'].includes(b.status) ? bankBox(b)
          : b.status === 'pending' ? `<div class="bk-wait"><span class="spin"></span><div><b>Confirming your payment with PayHere…</b><p>Seats ${b.tickets.map(t => t.seat).join(', ')} are reserved for you. Your tickets will appear here automatically, usually within a minute.</p></div></div>`
          : `<div class="bk-wait warn"><div><b>${statusLabel(b)}</b><p>Your payment was received, but there's a problem with a seat. The school office will contact you on ${esc(b.customer.phone)}. Quote booking ${b.ref}.</p></div></div>`}
      </section>`).join('');
    // keep checking slow confirmations, and notice when a ticket is checked in at the door
    clearTimeout(renderTickets._t);
    const stateOf = list => JSON.stringify(list.map(b => [b.ref, b.status, b.tickets.map(t => !!t.checkedInAt)]));
    const unused = mine.some(b => isValid(b) && b.tickets.some(t => !t.checkedInAt));
    if (Backend.live && (waiting || unused || transfers)) renderTickets._t = setTimeout(async function poll() {
      if (location.hash !== '#tickets' || document.hidden) { renderTickets._t = setTimeout(poll, 15000); return; }
      const before = stateOf(bookings);
      bookings = await DB.all().catch(() => bookings);
      if (stateOf(bookings) !== before) renderTickets(); else renderTickets._t = setTimeout(poll, waiting ? 4000 : 15000);
    }, waiting ? 4000 : 15000);
    $$('[data-pay]', box).forEach(x => x.addEventListener('click', () => openPay(x.dataset.pay)));
    $$('.ticket', box).forEach((tk, i) => { tk.style.animationDelay = (i * 0.1) + 's'; bindTicket(tk); });
  }

  async function sendSlip(inp) {
    const file = inp.files[0]; if (!file) return;
    const btn = inp.closest('.slip-btn'), lbl = btn.querySelector('b') || btn.querySelector('span');
    btn.classList.add('busy'); lbl.textContent = 'Uploading…';
    try {
      const b = await Backend.uploadSlip(inp.dataset.slip, file);
      bookings = bookings.map(x => x.ref === b.ref ? b : x);
      location.hash === '#pay' ? renderPay() : renderTickets();
      toast('Slip received! We\'ll verify it and SMS your tickets.');
    } catch (e) {
      btn.classList.remove('busy'); lbl.textContent = 'Upload payment slip';
      toast(e.message || 'Could not upload the slip. Please try again.');
    }
    inp.value = '';
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

  /* ---------- staff desk tabs ---------- */
  let stTab = sessionStorage.getItem('wv_st_tab') || '';
  function setStTab(t) {
    stTab = t; sessionStorage.setItem('wv_st_tab', t);
    $$('#stTabs [data-st]').forEach(b => b.classList.toggle('on', b.dataset.st === t));
    $$('#adminPanel .st-pane').forEach(p => p.hidden = p.dataset.pane !== t);
    if (t !== 'scan') stopScan();
  }

  /* ---------- bank transfers waiting for staff ---------- */
  let trTab = 'slip';
  function renderTransfers(list) {
    if (!Backend.live) { $('#trList').innerHTML = '<p class="tr-empty">Bank transfers appear here on the live site.</p>'; return; }
    const withSlip = list.filter(b => b.slipAt), noSlip = list.filter(b => !b.slipAt);
    $$('#trCard [data-tr]').forEach(x => {
      x.classList.toggle('on', x.dataset.tr === trTab);
      x.textContent = (x.dataset.tr === 'slip' ? 'Slip sent' : 'No slip yet') + ` (${(x.dataset.tr === 'slip' ? withSlip : noSlip).length})`;
    });
    const rows = (trTab === 'slip' ? withSlip : noSlip).sort((a, b) => new Date(a.slipAt || a.createdAt) - new Date(b.slipAt || b.createdAt));
    $('#trList').innerHTML = rows.length ? rows.map(b => `
      <div class="tr-row" data-ref="${b.ref}">
        <div class="tr-main">
          <div class="tr-amt">${rs(b.amount)}</div>
          <div class="tr-ref mono">${b.ref}</div>
          <div class="tr-who">${esc(fullName(b))} · <a href="tel:${esc(b.customer.phone || '')}">${esc(b.customer.phone || '')}</a></div>
          <div class="tr-seats">${b.tickets.map(t => `<span class="seat-tag ${t.tier}">${t.seat}</span>`).join('')}</div>
          <div class="tr-time">${b.slipAt ? `Slip sent ${fmtDate(b.slipAt)}` : `Booked ${fmtDate(b.createdAt)} · ${timeLeft(b.expiresAt)}`}</div>
        </div>
        <div class="tr-actions">
          ${b.slipAt ? `<button class="btn btn-ghost" data-act="slip" type="button">View slip</button>` : ''}
          <button class="btn tr-ok" data-act="approve" type="button">✓ Approve</button>
          <button class="btn btn-ghost tr-reject" data-act="reject" type="button">✕</button>
        </div>
        <div class="tr-confirm" hidden></div>
      </div>`).join('')
      : `<p class="tr-empty">${trTab === 'slip' ? 'No slips waiting. 🎉' : 'Nobody is waiting without a slip.'}</p>`;
  }

  async function transferAction(e) {
    const tab = e.target.closest('[data-tr]');
    if (tab) { trTab = tab.dataset.tr; renderTransfers(staffBookings.filter(b => b.status === 'awaiting_transfer')); return; }
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const row = btn.closest('.tr-row'), ref = row.dataset.ref, b = staffBookings.find(x => x.ref === ref);
    const box = row.querySelector('.tr-confirm');
    const act = btn.dataset.act;
    if (act === 'slip') return showSlip(b);
    if (act === 'approve') {
      box.innerHTML = `<p>Did <b>exactly ${rs(b.amount)}</b> with <b>${b.ref}</b> arrive in the school account?</p>
        <input class="tr-note" placeholder="Note (optional), e.g. seen in BOC app 25/11" maxlength="200" />
        <div><button class="btn btn-gold btn-sm" data-act="approve-yes" type="button">Yes, money received: issue tickets</button>
        <button class="btn btn-ghost btn-sm" data-act="cancel" type="button">Not yet</button></div>`;
      box.hidden = false; return;
    }
    if (act === 'reject') {
      box.innerHTML = `<p>Reject <b>${b.ref}</b> and release seats ${b.tickets.map(t => t.seat).join(', ')}? The buyer will see your reason.</p>
        <select class="tr-note"><option>Transfer not received</option><option>Amount does not match</option><option>Booking number missing from transfer: please contact the office</option><option>Duplicate booking</option></select>
        <div><button class="btn btn-sm tr-reject-yes" data-act="reject-yes" type="button">Reject &amp; release seats</button>
        <button class="btn btn-ghost btn-sm" data-act="cancel" type="button">Cancel</button></div>`;
      box.hidden = false; return;
    }
    if (act === 'cancel') { box.hidden = true; return; }
    const note = box.querySelector('.tr-note')?.value || '';
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (act === 'approve-yes') {
        const nb = await DB.approveTransfer(ref, note);
        toast(nb.smsResult === 'sent'
          ? `✓ <b>${ref}</b> approved. Tickets sent by SMS to ${esc(nb.customer.phone)}. Nothing else to do.`
          : `✓ <b>${ref}</b> approved. Tickets are on the buyer's booking page${nb.emailResult === 'sent' ? ' and emailed' : ''}.${nb.smsResult === 'no-mobile' ? ' (Not a mobile number, so no SMS.)' : ''}`);
      } else {
        await DB.rejectTransfer(ref, note);
        toast(`<b>${ref}</b> rejected. Seats released.`);
      }
      renderAdmin();
    } catch (err) {
      toast(err.message || 'Could not save. Try again.');
      btn.disabled = false; btn.textContent = act === 'approve-yes' ? 'Yes, money received: issue tickets' : 'Reject & release seats';
    }
  }

  async function showSlip(b) {
    const m = $('#slipModal'), view = $('#slipView');
    $('#slipTitle').textContent = `${b.ref} · ${rs(b.amount)} · ${fullName(b)}`;
    view.innerHTML = '<p class="tr-empty">Loading slip…</p>'; m.hidden = false;
    try {
      const { url, pdf } = await DB.slipLink(b.ref);
      $('#slipOpen').href = url;
      view.innerHTML = pdf ? `<iframe src="${url}" title="Slip PDF"></iframe>` : `<img src="${url}" alt="Transfer slip" />`;
    } catch (e) { view.innerHTML = `<p class="tr-empty">${esc(e.message || 'Could not open the slip.')}</p>`; }
  }

  function staffLock() {
    staffOpen = false; sessionStorage.removeItem('wv_staff'); Backend.staffLogout(); stopScan(); renderAdmin(false);
  }

  async function renderAdmin(refetch = true) {
    if (Backend.live) staffOpen = Backend.staffSignedIn;
    $('#adminGate').hidden = staffOpen;
    $('#adminPanel').hidden = !staffOpen;
    $('#pinNote').hidden = Backend.live;
    if (!staffOpen) { setTimeout(() => $('#pinInput').focus(), 100); return; }
    if (refetch) try {
      staffBookings = await (DB.staffAll ? DB.staffAll() : DB.all());
      if (Backend.live) syncTaken(await DB.bookedSeatIds());
    } catch (e) {
      if (e.status === 401) { Backend.staffLogout(); staffOpen = false; return renderAdmin(); }
      toast('Could not load bookings: ' + e.message); return;
    }
    const valid = staffBookings.filter(isValid);
    const tickets = valid.flatMap(b => b.tickets);
    const online = valid.filter(b => b.status !== 'cash' && b.channel !== 'bank').reduce((a, b) => a + b.amount, 0);
    const bankIn = valid.filter(b => b.channel === 'bank').reduce((a, b) => a + b.amount, 0);
    const trWaiting = staffBookings.filter(b => b.status === 'awaiting_transfer');
    const office = valid.filter(b => b.status === 'cash').reduce((a, b) => a + b.amount, 0);
    const inside = tickets.filter(t => t.checkedInAt).length;
    const issues = staffBookings.filter(b => ['paid_conflict', 'chargedback'].includes(b.status)).length;
    const left = Object.fromEntries(TIER_KEYS.map(k => [k, 0]));
    seats.forEach(s => { if (!s.taken) left[s.tier]++; });
    // top summary + tab counts
    $('#stSum').innerHTML = `<span><b>${tickets.length}</b> sold</span><span><b>${rs(bankIn + online + office)}</b> received</span><span><b>${inside}</b> inside</span>`;
    $('#stApproveN').textContent = trWaiting.filter(b => b.slipAt).length || '';
    $('#stScanN').textContent = `${inside} / ${tickets.length} in`;
    $('#stListN').textContent = `${staffBookings.length}`;
    if (!stTab) setStTab(trWaiting.some(b => b.slipAt) ? 'approve' : 'scan');
    $('#stats').innerHTML = `
      <div><small>Tickets sold</small><b>${tickets.length}</b>${issues ? `<small class="warn-txt">${issues} need attention</small>` : ''}</div>
      ${Backend.methods.includes('payhere') ? `<div><small>Online (PayHere)</small><b>${rs(online)}</b><small>limit ${rs(Backend.config.monthlyCap)} / month</small></div>` : ''}
      ${Backend.live && Backend.methods.includes('bank') ? `<div><small>Bank transfers</small><b>${rs(bankIn)}</b><small class="${trWaiting.length ? 'warn-txt' : ''}">${trWaiting.length} waiting to confirm</small></div>` : ''}
      <div><small>At the office</small><b>${rs(office)}</b></div>
      <div><small>Checked in</small><b>${inside} <em>/ ${tickets.length}</em></b></div>
      <div><small>Seats left</small><b class="left"><span class="v">${left.vip}<i>VIP</i></span><span class="g">${left.gold}<i>Gold</i></span><span class="s">${left.silver}<i>Silver</i></span><span class="b">${left.bronze}<i>Bronze</i></span></b></div>`;

    renderTransfers(trWaiting);

    const q = adminQuery.toLowerCase().replace(/\s+/g, '');
    const rows = staffBookings.filter(b => !q || [b.ref, fullName(b), b.customer.phone, b.customer.email, b.customer.student, b.paymentId, ...b.tickets.map(t => t.seat)]
      .join('|').toLowerCase().replace(/\s+/g, '').includes(q));
    $('#stListN').textContent = adminQuery ? `${rows.length} of ${staffBookings.length}` : `${staffBookings.length}`;
    $('#bkBody').innerHTML = rows.length ? rows.map(b => {
      const ins = b.tickets.filter(t => t.checkedInAt).length;
      return `<tr class="bk-row" data-ref="${b.ref}">
        <td class="mono c-ref">${b.ref}${b.paymentId ? `<small>PayHere ${esc(b.paymentId)}</small>` : b.channel === 'bank' ? `<small>Bank transfer</small>` : ''}</td>
        <td class="c-name">${esc(fullName(b))}<small>${esc(b.customer.role || '')}${b.customer.student ? ' · ' + esc(b.customer.student) : ''}</small></td>
        <td class="c-contact">${esc(b.customer.phone || '')}<small>${esc(b.customer.email || '')}</small></td>
        <td class="c-seats">${b.tickets.map(t => `<span class="seat-tag ${t.tier}${t.checkedInAt ? ' in' : ''}">${t.seat}</span>`).join('')}</td>
        <td class="num c-amt">${rs(b.amount)}</td>
        <td class="c-pay"><span class="status ${isValid(b) ? 'ok' : 'warn'}">${statusLabel(b)}</span></td>
        <td class="num c-in"><span class="c-lbl">In </span>${ins}/${b.tickets.length}</td>
        <td class="c-date"><small>${fmtDate(b.createdAt)}</small></td>
      </tr>`;
    }).join('') : `<tr><td colspan="8" class="empty">${staffBookings.length ? 'No bookings match your search.' : 'No bookings yet.'}</td></tr>`;
  }

  async function recordCashSale(e) {
    e.preventDefault();
    const f = e.target.elements;
    const ids = [...new Set(f.seats.value.toUpperCase().split(/[\s,]+/).filter(Boolean))];
    const bad = ids.filter(id => !seats.has(id));
    if (!ids.length || bad.length) { toast(bad.length ? `No such seat: ${bad.join(', ')}` : 'Enter the seat numbers, e.g. C4, C5'); return; }
    const [first, ...rest] = (f.name.value.trim() || 'Office sale').split(' ');
    const customer = { first, last: rest.join(' ') || '-', phone: f.phone.value.trim(), email: (f.email?.value || '').trim(), role: 'Cash sale', student: '' };
    try {
      let b;
      if (Backend.live) b = await DB.cashSale(ids, customer);
      else {
        const ref = DB.newRef();
        b = { ref, status: 'cash', amount: ids.reduce((a, id) => a + TIERS[seats.get(id).tier].price, 0), currency: 'LKR', createdAt: new Date().toISOString(), customer,
          tickets: ids.map(id => { const s = seats.get(id); return { ticketId: `${ref}-${id}`, seat: id, row: s.row, num: s.num, tier: s.tier, price: TIERS[s.tier].price, checkedInAt: null }; }) };
        await DB.create(b);
      }
      markTaken(ids); updateAvailability();
      e.target.reset();
      toast(`Recorded ${ids.join(', ')} as sold at the office (${rs(b.amount)}). Booking <b>${b.ref}</b>${b.emailResult === 'sent' ? ' · tickets emailed ✓' : ''}`);
      renderAdmin();
    } catch (err) { toast(err.data?.message || err.message); }
  }

  function resultCard(kind, booking, ticket, extra = '') {
    const box = $('#ciResult');
    const titles = { ok: 'Valid ticket · checked in', already: 'Already checked in', missing: 'Ticket not found', booking: 'Booking found', unpaid: 'Not paid: do not admit' };
    let body = '';
    if (booking) {
      const tks = ticket ? [ticket] : booking.tickets;
      body = `
        <div class="ci-who"><b>${esc(fullName(booking))}</b><span>${esc(booking.customer.phone)} · ${booking.ref} · ${statusLabel(booking)}</span>
          ${Backend.live && booking.customer.phone && isValid(booking) ? `<button class="sms-btn" data-sms="${booking.ref}" type="button"><svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 18h4"/></svg><span><b>Send tickets by SMS</b><small>to ${esc(booking.customer.phone)}</small></span></button>` : ''}</div>
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
    try { await doCheckInInner(code); }
    catch (e) { toast('Check-in failed: ' + (e.data?.message || e.message) + '. Check the internet connection.'); }
  }
  async function doCheckInInner(code) {
    code = String(code || '').trim();
    try { const u = new URL(code); if (u.searchParams.get('t')) code = u.searchParams.get('t'); } catch {}   // QR = verify link
    code = code.toUpperCase();
    if (!code) return;
    if (/^WV-[A-Z0-9]{6}$/.test(code)) {             // a booking number: show all its tickets
      const b = await DB.byRef(code);
      b ? resultCard('booking', b) : resultCard('missing', null, null, `<p>No booking <b>${esc(code)}</b>.</p>`);
      return;
    }
    const r = await DB.checkIn(code);
    if (r.result === 'missing') resultCard('missing', null, null, `<p>No ticket <b>${esc(code)}</b>. Check the number, or search the bookings by name or phone.</p>`);
    else if (r.result === 'already') resultCard('already', r.booking, r.ticket, `<p>This ticket was already used. Ask for ID before letting them in.</p>`);
    else if (r.result === 'unpaid') resultCard('unpaid', r.booking, null, `<p>This booking is <b>${statusLabel(r.booking)}</b>. Send them to the office.</p>`);
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
    wrap.hidden = false; $('#scanBtn span').textContent = 'Stop camera'; $('#scanBtn').classList.add('on');
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
    $('#ciCam').hidden = true; $('#scanBtn span').textContent = 'Scan QR code'; $('#scanBtn').classList.remove('on');
  }

  function exportCSV() {
    const head = ['Booking number', 'Ticket number', 'Seat', 'Tier', 'Price (LKR)', 'First name', 'Last name', 'Phone', 'Email', 'Joining as', 'Student', 'Status', 'Payment ID', 'Booked at', 'Checked in at'];
    const lines = [head];
    staffBookings.forEach(b => b.tickets.forEach(t => lines.push([b.ref, t.ticketId, t.seat, TIERS[t.tier].label, t.price, b.customer.first, b.customer.last, b.customer.phone, b.customer.email, b.customer.role, b.customer.student, statusLabel(b), b.paymentId || '', b.createdAt, t.checkedInAt || ''])));
    const csv = lines.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `winter-vespers-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  function bindAdmin() {
    $('#pinForm').addEventListener('submit', async e => {
      e.preventDefault();
      const pin = $('#pinInput').value;
      const ok = Backend.live ? await Backend.staffLogin(pin) : (pin === STAFF_PIN || 'Wrong PIN.');
      if (ok === true) { staffOpen = true; if (!Backend.live) sessionStorage.setItem('wv_staff', '1'); $('#pinInput').value = ''; renderAdmin(); }
      else { $('#pinInput').classList.add('bad'); toast(ok); }
    });
    $('#cashForm').addEventListener('submit', recordCashSale);
    $('#pinInput').addEventListener('input', e => e.target.classList.remove('bad'));
    $('#lockBtn').onclick = () => staffLock();
    $('#trCard').addEventListener('click', transferAction);
    $('#stTabs').addEventListener('click', e => { const b = e.target.closest('[data-st]'); if (b) setStTab(b.dataset.st); });
    $('#slipClose').onclick = () => { $('#slipModal').hidden = true; $('#slipView').innerHTML = ''; };
    $('#slipModal').addEventListener('click', e => { if (e.target.id === 'slipModal') $('#slipClose').click(); });

    /* auto sign-out: 10 minutes with no taps, typing or scrolling → lock and go Home */
    const IDLE_MS = 10 * 60 * 1000;
    let lastActive = Date.now();
    const poke = () => { lastActive = Date.now(); };
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(ev => addEventListener(ev, poke, { passive: true }));
    const idleCheck = () => {
      if (!staffOpen && !Backend.staffSignedIn) return;
      if (Date.now() - lastActive < IDLE_MS) return;
      staffLock();
      if (location.hash === '#admin') location.hash = '#home';
      toast('Staff page locked after 10 minutes of no activity. Enter the PIN to continue.');
    };
    setInterval(idleCheck, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) idleCheck(); });
    $('#ciForm').addEventListener('submit', e => { e.preventDefault(); doCheckIn($('#ciInput').value); });
    $('#scanBtn').onclick = () => (camStream ? stopScan() : startScan());
    $('#bkSearch').addEventListener('input', e => { adminQuery = e.target.value; renderAdmin(false); });
    $('#csvBtn').onclick = exportCSV;
    $('#bkBody').addEventListener('click', async e => {
      const tr = e.target.closest('.bk-row'); if (!tr) return;
      resultCard('booking', await DB.byRef(tr.dataset.ref));
      $('#ciResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('#ciResult').addEventListener('click', async e => {
      const sm = e.target.closest('[data-sms]');
      if (sm) {
        const lbl = sm.querySelector('b');
        sm.disabled = true; lbl.textContent = 'Sending…';
        try {
          const r = await DB.resendSms(sm.dataset.sms);
          lbl.textContent = r === 'sent' ? 'SMS sent ✓' : r === 'no-mobile' ? 'Not a mobile number' : r === 'not-configured' ? 'SMS not set up yet' : 'Could not send, try again';
          if (r === 'sent') sm.classList.add('done'); else sm.disabled = false;
        } catch (err) { lbl.textContent = 'Could not send, try again'; sm.disabled = false; }
        return;
      }
      const rsd = e.target.closest('[data-resend]');
      if (rsd) {
        rsd.disabled = true; rsd.textContent = 'Sending…';
        try { const r = await DB.resendEmail(rsd.dataset.resend); rsd.textContent = r === 'sent' ? 'Email sent ✓' : r === 'not-configured' ? 'Email not set up yet' : `Not sent (${r})`; }
        catch (err) { rsd.textContent = 'Failed: ' + err.message; }
        return;
      }
      const ci = e.target.closest('[data-checkin]'), un = e.target.closest('[data-undo]');
      if (ci) doCheckIn(ci.dataset.checkin);
      if (un) { const r = await DB.undoCheckIn(un.dataset.undo); if (r) { resultCard('booking', r.booking); renderAdmin(); } }
    });
  }

  // The stub tears off by itself once door staff have checked the ticket in.
  const TORN_SEEN = 'wv_torn_seen';
  function bindTicket(tk) {
    const stub = $('.t-stub', tk);
    const setStubH = () => tk.style.setProperty('--stubH', stub.offsetHeight + 'px');   // phones: tear line on top of the stub
    requestAnimationFrame(setStubH); addEventListener('resize', setStubH);
    if (!tk.classList.contains('used')) return;
    const seen = store.get(TORN_SEEN, []), id = tk.dataset.no;
    if (seen.includes(id)) { tk.classList.add('torn-done'); return; }        // already watched it tear
    setTimeout(() => {                                                       // first time: play the tear
      tk.classList.add('cutting');
      setTimeout(() => { tk.classList.remove('cutting'); tk.classList.add('torn'); store.set(TORN_SEEN, [...seen, id]); }, 900);
    }, 700);
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  const VIEWS = ['home', 'seats', 'checkout', 'pay', 'tickets', 'admin'];
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
    if (v === 'seats') requestAnimationFrame(phoneStart);
    if (v === 'checkout') renderCheckout();
    if (v === 'tickets') renderTickets();
    if (v === 'pay') renderPay();
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
  // small labels so nobody mistakes test mode for the real thing
  function applyModeUI() {
    const box = $('#payOptions'), note = $('#payNote');
    const OPT = {
      bank: ['Bank transfer', 'No fees. We hold your seats, you transfer to the school account with your booking number, and your tickets are issued once the school confirms the payment.', '<svg viewBox="0 0 24 24"><path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/></svg>'],
      payhere: ['Card / mobile wallet (PayHere)', 'Pay by card, eZ Cash, mCash or Genie on PayHere\'s secure page. Tickets straight away.', '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/></svg>'],
    };
    const methods = Backend.live ? Backend.methods : ['payhere'];
    box.innerHTML = methods.map((m, i) => `
      <label class="pay-option${i === 0 ? ' selected' : ''}">
        <input type="radio" name="method" value="${m}" ${i === 0 ? 'checked' : ''} hidden />
        <div class="radio"></div><span class="po-ic">${OPT[m][2]}</span>
        <div><strong>${OPT[m][0]}</strong><p>${OPT[m][1]}</p></div>
        ${!Backend.live ? '<span class="badge">Demo</span>' : ''}
      </label>`).join('');
    box.addEventListener('change', () => {
      $$('.pay-option', box).forEach(o => o.classList.toggle('selected', o.querySelector('input').checked));
      renderCheckout();
    });
    if (!Backend.live) note.innerHTML = 'Payments are not connected on this copy of the site. The button runs a <b>demo</b> so you can see the whole flow.';
    else if (methods.includes('bank') && Backend.bank?.sample) note.innerHTML = '<b>Test mode:</b> the school\'s real bank details are not added yet, so you will see <b>sample</b> details. Please don\'t transfer any money.';
    else if (methods[0] === 'bank') note.innerHTML = 'After you reserve, you\'ll see the school\'s bank details and your booking number. Seats are held for ' + (Backend.config.bankHoldHours || 24) + ' hours.';
    else note.innerHTML = Backend.sandbox ? '<b>Test mode (PayHere sandbox):</b> use a PayHere test card. No real money is taken.' : 'You will pay on PayHere\'s secure page.';
    if (Backend.live && Backend.testMode)
      document.body.insertAdjacentHTML('beforeend', `<div class="mode-banner">TEST MODE · ${methods.includes('bank') && Backend.bank?.sample ? "sample bank details, don't transfer money" : 'payments are not real'}</div>`);
  }

  async function init() {
    await Backend.init();
    if (Backend.live) {
      [liveTaken, bookings] = await Promise.all([DB.bookedSeatIds().catch(() => []), DB.all().catch(() => [])]);
      myRefs = [...new Set([...myRefs, ...bookings.map(b => b.ref)])].filter(r => bookings.some(b => b.ref === r));
      // keep the map fresh while someone is choosing seats
      setInterval(async () => { if (location.hash === '#seats' && !document.hidden) syncTaken(await DB.bookedSeatIds().catch(() => liveTaken)); }, 20000);
    } else bookings = await DB.all();
    applyModeUI();
    buildHall();
    setFloor('ground', { instant: true });
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
      if (cp) copyText(cp);
    });
    addEventListener('hashchange', route);
    // nothing on the page can be dragged out (pictures, logo, titles); file pickers still work
    document.addEventListener('dragstart', e => { if (!e.target.closest?.('input')) e.preventDefault(); });
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
      if (run[0].floor !== floor) setFloor(run[0].floor, { instant: true });
      run.forEach((s, i) => setTimeout(() => toggleSeat(s.id), i * 90));
      if (fitMode() || view.z > 1) zoomTo(Math.max(view.z, fitMode() ? tapZoom() : 1), run.reduce((a, s) => a + s.x, 0) / run.length, run[0].y);
      toast(`Picked ${run.map(s => s.id).join(', ')} — ${TIERS[tier].label}${run[0].floor === 'gallery' ? ' (Gallery)' : ''}, side by side.`);
    };

    $('#snowToggle').onclick = () => { const on = Snow.toggle(); $('#snowToggle').classList.toggle('off', !on); };
    $('#resetDemo').hidden = Backend.live;
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
