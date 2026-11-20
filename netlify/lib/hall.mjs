// Seat plan + prices, checked on the SERVER so nobody can change a price in their browser.
// The plan itself lives in js/hall-plan.js, shared with the website, so they can never disagree.
import plan from '../../js/hall-plan.js';

export const TIERS = plan.TIERS;

/** 'C4' -> { seat:'C4', row:'C', num:4, tier:'vip', price:5000 } or null if no such seat */
export const seatInfo = plan.seatInfo;
