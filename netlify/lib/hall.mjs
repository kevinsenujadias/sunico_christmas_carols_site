// Seat plan + prices, checked on the SERVER so nobody can change a price in their browser.
// Keep in sync with ROWS / TIERS at the top of js/app.js.
export const TIERS = {
  gold:   { label: 'Gold',   price: 3500 },
  silver: { label: 'Silver', price: 2500 },
  bronze: { label: 'Bronze', price: 1500 },
};
const ROWS = [
  ...'ABCD'.split('').map(r => ({ row: r, tier: 'gold',   seats: 20 })),
  ...'EFGHIJ'.split('').map(r => ({ row: r, tier: 'silver', seats: 22 })),
  ...'KLMN'.split('').map(r => ({ row: r, tier: 'bronze', seats: 22 })),
];
const BY_ROW = Object.fromEntries(ROWS.map(r => [r.row, r]));

/** 'C4' -> { seat:'C4', row:'C', num:4, tier:'gold', price:3500 } or null if no such seat */
export function seatInfo(id) {
  const m = /^([A-Z])(\d{1,2})$/.exec(String(id || '').trim().toUpperCase());
  if (!m) return null;
  const r = BY_ROW[m[1]], num = +m[2];
  if (!r || num < 1 || num > r.seats) return null;
  return { seat: m[1] + num, row: m[1], num, tier: r.tier, price: TIERS[r.tier].price };
}
