/* =========================================================
   BOOKING RECORDS — the one place bookings are saved & read.
   ---------------------------------------------------------
   RIGHT NOW: records live in this browser (localStorage).
   That's fine for testing, but staff on another phone
   can't see them.

   GOING LIVE: replace the bodies of these functions with
   calls to a real database (e.g. Supabase / Firebase).
   Every function already returns a Promise, so nothing
   else in the site needs to change.

   Record shape:
   {
     ref: 'WV-7K3QX9',               // booking reference
     status: 'paid' | 'paid-demo',
     paymentId: 'PayHere payment id or null',
     amount: 4750, currency: 'LKR',
     createdAt: ISO string,
     customer: { first, last, email, phone, role, student },
     tickets: [{ ticketId:'WV-7K3QX9-C4', seat:'C4', row:'C', num:4,
                 tier:'gold', price:3500, checkedInAt:null }]
   }
   ========================================================= */
window.DB = (function () {
  const KEY = 'wv_bookings_v2';
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I — easy to read out loud

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const write = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} };
  const norm = s => String(s || '').toUpperCase().replace(/\s+/g, '').trim();
  const digits = s => String(s || '').replace(/\D/g, '');

  function newRef() {
    const taken = new Set(read().map(b => b.ref));
    let ref;
    do {
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      ref = 'WV-' + [...bytes].map(b => ALPHA[b % ALPHA.length]).join('');
    } while (taken.has(ref));
    return ref;
  }

  function findTicketIn(list, ticketId) {
    const id = norm(ticketId);
    for (const b of list) for (const t of b.tickets) if (t.ticketId === id) return { booking: b, ticket: t };
    return null;
  }

  return {
    newRef,

    async all() { return read(); },

    async bookedSeatIds() { return read().flatMap(b => b.tickets.map(t => t.seat)); },

    /* Saves a booking. Fails if any seat was sold in the meantime. */
    async create(booking) {
      const list = read();
      const sold = new Set(list.flatMap(b => b.tickets.map(t => t.seat)));
      const clash = booking.tickets.filter(t => sold.has(t.seat)).map(t => t.seat);
      if (clash.length) throw new Error(`Seat ${clash.join(', ')} was just booked by someone else.`);
      list.unshift(booking); write(list);
      return booking;
    },

    async byRef(ref) { return read().find(b => b.ref === norm(ref)) || null; },

    /* Customer lookup: booking reference + phone number must both match. */
    async lookup(ref, phone) {
      const b = read().find(x => x.ref === norm(ref));
      if (!b) return null;
      return digits(b.customer.phone).slice(-7) === digits(phone).slice(-7) ? b : null;
    },

    async findTicket(ticketId) { return findTicketIn(read(), ticketId); },

    /* Door check-in. Returns { result: 'ok' | 'already' | 'missing', booking, ticket } */
    async checkIn(ticketId) {
      const list = read();
      const hit = findTicketIn(list, ticketId);
      if (!hit) return { result: 'missing' };
      if (hit.ticket.checkedInAt) return { result: 'already', ...hit };
      hit.ticket.checkedInAt = new Date().toISOString();
      write(list);
      return { result: 'ok', ...hit };
    },

    async undoCheckIn(ticketId) {
      const list = read();
      const hit = findTicketIn(list, ticketId);
      if (hit) { hit.ticket.checkedInAt = null; write(list); }
      return hit;
    },

    async reset() { localStorage.removeItem(KEY); localStorage.removeItem('wv_orders'); }
  };
})();
