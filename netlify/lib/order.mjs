// Shared checks for a new order: who is buying and which seats (priced HERE, never by the browser).
import { seatInfo } from './hall.mjs';
import { json, fail } from './http.mjs';

export const MAX_SEATS = 10;
export const clean = (v, n = 80) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);

/** returns { customer, seats, ids, amount } or { error: Response } */
export function checkOrder(body) {
  const c = body.customer || {};
  const customer = {
    first: clean(c.first, 40), last: clean(c.last, 40), email: clean(c.email, 120).toLowerCase(),
    phone: clean(c.phone, 20), role: clean(c.role, 40), student: clean(c.student, 80),
  };
  if (!customer.first || !customer.last) return { error: fail('NAME', 'Please enter your name.') };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) return { error: fail('EMAIL', 'Please enter a valid email.') };
  if (customer.phone.replace(/\D/g, '').length < 9) return { error: fail('PHONE', 'Please enter a valid phone number.') };

  const ids = [...new Set((Array.isArray(body.seats) ? body.seats : []).map(s => String(s).toUpperCase()))];
  if (!ids.length) return { error: fail('NO_SEATS', 'Pick at least one seat.') };
  if (ids.length > MAX_SEATS) return { error: fail('TOO_MANY', `You can book up to ${MAX_SEATS} seats at a time.`) };
  const seats = ids.map(seatInfo);
  if (seats.some(s => !s)) return { error: fail('BAD_SEAT', 'One of those seats does not exist.') };
  return { customer, seats, ids, amount: seats.reduce((a, s) => a + s.price, 0) };
}

/** turn database errors into friendly answers */
export function orderError(e) {
  if (e.message.startsWith('SEAT_TAKEN:')) {
    const taken = e.message.split(':')[1].split(',');
    return json({ error: 'SEAT_TAKEN', taken, message: `Sorry, ${taken.join(', ')} ${taken.length > 1 ? 'were' : 'was'} just booked by someone else.` }, 409);
  }
  if (e.message.startsWith('ONLINE_LIMIT')) return json({ error: 'ONLINE_LIMIT', message: 'Online ticket sales are full for this month. Please buy your tickets at the school office.' }, 409);
  if (e.message.startsWith('TOO_MANY_WAITING')) return json({ error: 'TOO_MANY_WAITING', message: 'You already have bookings waiting for a bank transfer. Please pay for those first (or wait until they expire) before booking more seats.' }, 429);
  return fail('DB', 'Could not reserve your seats. Please try again.', e.status || 500);
}
