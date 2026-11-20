/* =========================================================
   NAMAL HALL — seat plan + prices (ONE place for both the
   website and the server, so they can never disagree).
   ---------------------------------------------------------
   Ground floor (stage at the front):
     two blocks of 14 rows x 28 seats, centre aisle
       rows A–C  VIP     (3 rows)
       rows D–I  Gold    (6 rows)
       rows J–N  Silver  (5 rows)
     behind them, beside the lift:
       rows P–W  Bronze  (left block 6 seats, right block 12)
   Gallery (upstairs): all Gold
     four blocks of 5 seats x 14 rows (GA–GN)
     + small middle block 5 seats x 4 rows (GA–GD), buffet & sound below it
   Seat ids: "A1".."N56", "P1".."W18", "GA1".."GN25"
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HALL_PLAN = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TIERS = {
    vip:    { label: 'VIP',    price: 5000 },
    gold:   { label: 'Gold',   price: 3500 },
    silver: { label: 'Silver', price: 2500 },
    bronze: { label: 'Bronze', price: 1500 },
  };

  const SX = 30, SY = 32;                      // seat spacing in map units (seat squares are 26)
  const L = n => String.fromCharCode(64 + n);   // 1 -> A

  // A block = a rectangle of seats. x/y = centre of its first seat (front-left).
  const BLOCKS = [
    // ---- ground floor ----
    { id: 'gL', floor: 'ground', rows: 'ABCDEFGHIJKLMN', seats: 28, first: 1,  x: 80,   y: 260, side: 'left' },
    { id: 'gR', floor: 'ground', rows: 'ABCDEFGHIJKLMN', seats: 28, first: 29, x: 1000, y: 260, side: 'right' },
    { id: 'bL', floor: 'ground', rows: 'PQRSTUVW', seats: 6,  first: 1, x: 645,  y: 860, side: 'left' },
    { id: 'bR', floor: 'ground', rows: 'PQRSTUVW', seats: 12, first: 7, x: 1095, y: 860, side: 'right' },
    // ---- gallery (upstairs) ----
    { id: 'G1', floor: 'gallery', rows: 'ABCDEFGHIJKLMN', prefix: 'G', seats: 5, first: 1,  x: 110,  y: 200, side: 'left' },
    { id: 'G2', floor: 'gallery', rows: 'ABCDEFGHIJKLMN', prefix: 'G', seats: 5, first: 6,  x: 430,  y: 200 },
    { id: 'G3', floor: 'gallery', rows: 'ABCD',           prefix: 'G', seats: 5, first: 11, x: 690,  y: 200 },
    { id: 'G4', floor: 'gallery', rows: 'ABCDEFGHIJKLMN', prefix: 'G', seats: 5, first: 16, x: 950,  y: 200 },
    { id: 'G5', floor: 'gallery', rows: 'ABCDEFGHIJKLMN', prefix: 'G', seats: 5, first: 21, x: 1270, y: 200, side: 'right' },
  ];

  // rows -> tier
  const tierOf = (floor, rowLetter) => {
    if (floor === 'gallery') return 'gold';
    if ('ABC'.includes(rowLetter)) return 'vip';
    if ('DEFGHI'.includes(rowLetter)) return 'gold';
    if ('JKLMN'.includes(rowLetter)) return 'silver';
    return 'bronze';
  };

  // extra vertical gaps so the tiers are clearly separated on the map
  const rowGap = (floor, r) => (floor !== 'ground' ? 0 : 'DEFGHIJKLMN'.includes(r) ? 40 : 0) + (floor === 'ground' && 'JKLMN'.includes(r) ? 34 : 0);

  const seats = [];
  for (const b of BLOCKS) {
    [...b.rows].forEach((r, ri) => {
      const row = (b.prefix || '') + r;
      const tier = tierOf(b.floor, r);
      for (let i = 0; i < b.seats; i++) {
        const num = b.first + i;
        seats.push({
          id: row + num, row, num, tier, floor: b.floor, block: b.id, side: b.side,
          x: b.x + i * SX, y: b.y + ri * SY + rowGap(b.floor, r),
          order: ri,                              // 0 = front row of its block
        });
      }
    });
  }
  const byId = Object.fromEntries(seats.map(s => [s.id, s]));

  const FLOORS = {
    ground: {
      label: 'Ground floor', w: 1890, h: 1140,
      stage: { x: 665, y: 24, w: 560, h: 150, label: 'STAGE' },
      boxes: [
        { x: 835, y: 842, w: 220, h: 260, label: 'LIFT', kind: 'lift' },
      ],
      notes: [
        { x: 945, y: 232, text: 'VIP · ROWS A–C', tier: 'vip' },
        { x: 945, y: 370, text: 'GOLD · ROWS D–I', tier: 'gold' },
        { x: 945, y: 598, text: 'SILVER · ROWS J–N', tier: 'silver' },
        { x: 945, y: 820, text: 'BRONZE · ROWS P–W', tier: 'bronze' },
      ],
    },
    gallery: {
      label: 'Gallery (upstairs)', w: 1500, h: 680,
      stage: { x: 470, y: 24, w: 560, h: 60, label: 'BALCONY FRONT · FACING THE STAGE', kind: 'rail' },
      boxes: [
        { x: 680, y: 330, w: 140, h: 310, label: 'BUFFET & SOUND', kind: 'service' },
      ],
      notes: [{ x: 750, y: 160, text: 'GALLERY · ALL GOLD · ROWS GA–GN', tier: 'gold' }],
    },
  };

  /** 'C4' -> seat info with price, or null */
  function seatInfo(id) {
    const s = byId[String(id || '').trim().toUpperCase()];
    return s ? { seat: s.id, row: s.row, num: s.num, tier: s.tier, price: TIERS[s.tier].price } : null;
  }

  return { TIERS, FLOORS, BLOCKS, seats, byId, seatInfo, SX, SY };
});
