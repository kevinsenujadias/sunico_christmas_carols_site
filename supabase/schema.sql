-- =========================================================
-- Winter Vespers 2026 · ticketing database (Supabase / Postgres)
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run again: it replaces the functions, keeps your data.
-- =========================================================

-- ---------- tables ----------
create table if not exists public.bookings (
  ref            text primary key,                 -- booking number, e.g. WV-7K3QX9
  access_key     text not null,                    -- secret that lets the buyer's phone load the tickets
  status         text not null default 'pending'
                 check (status in ('pending','paid','cancelled','failed','expired','paid_conflict','chargedback','cash')),
  channel        text not null default 'online' check (channel in ('online','cash')),
  amount         numeric(10,2) not null check (amount > 0),
  currency       text not null default 'LKR',
  seats          jsonb not null,                   -- [{seat,row,num,tier,price}]
  customer       jsonb not null,                   -- {first,last,email,phone,role,student}
  payment_id     text,                             -- PayHere payment id
  payment_method text,                             -- VISA, MASTER, EZCASH, ...
  status_message text,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz,                      -- pending seats are released after this
  paid_at        timestamptz,
  updated_at     timestamptz not null default now()
);

create table if not exists public.tickets (
  ticket_id     text primary key,                  -- WV-7K3QX9-C4
  booking_ref   text not null references public.bookings(ref) on delete cascade,
  seat          text not null unique,              -- one seat can only be on one live ticket
  row_letter    text not null,
  seat_num      int  not null,
  tier          text not null,
  price         numeric(10,2) not null,
  checked_in_at timestamptz
);

-- added later: when the confirmation email went out (null = not sent yet)
alter table public.bookings add column if not exists email_sent_at timestamptz;

create index if not exists bookings_created_idx on public.bookings (created_at);
create index if not exists tickets_booking_idx on public.tickets (booking_ref);

-- Lock the tables down: only the server functions (secret key) may touch them.
alter table public.bookings enable row level security;
alter table public.tickets  enable row level security;
revoke all on public.bookings, public.tickets from anon, authenticated;

-- ---------- helpers ----------
-- Release seats from unpaid bookings whose time ran out.
create or replace function public.wv_release_expired() returns void
language plpgsql security definer set search_path = public as $$
begin
  update bookings set status = 'expired', updated_at = now()
   where status = 'pending' and expires_at < now();
  delete from tickets t using bookings b
   where t.booking_ref = b.ref and b.status in ('expired','cancelled','failed');
end $$;

-- Online money taken (or being paid) this calendar month, Sri Lanka time.
create or replace function public.wv_online_month_total() returns numeric
language sql security definer set search_path = public as $$
  select coalesce(sum(amount),0) from bookings
   where channel = 'online'
     and status in ('pending','paid','paid_conflict')
     and date_trunc('month', created_at at time zone 'Asia/Colombo')
       = date_trunc('month', now()        at time zone 'Asia/Colombo');
$$;

create or replace function public.wv_booking_json(b bookings) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'ref', b.ref, 'status', b.status, 'channel', b.channel, 'amount', b.amount, 'currency', b.currency,
    'customer', b.customer, 'payment_id', b.payment_id, 'payment_method', b.payment_method,
    'created_at', b.created_at, 'paid_at', b.paid_at, 'expires_at', b.expires_at, 'email_sent_at', b.email_sent_at,
    'tickets', coalesce((select jsonb_agg(jsonb_build_object(
        'ticketId', t.ticket_id, 'seat', t.seat, 'row', t.row_letter, 'num', t.seat_num,
        'tier', t.tier, 'price', t.price, 'checkedInAt', t.checked_in_at) order by t.row_letter, t.seat_num)
      from tickets t where t.booking_ref = b.ref), '[]'::jsonb));
$$;

-- ---------- 1. reserve seats while the buyer pays ----------
create or replace function public.wv_create_pending_booking(
  p_ref text, p_access_key text, p_amount numeric, p_seats jsonb, p_customer jsonb,
  p_month_cap numeric, p_hold_minutes int default 15
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_taken text[];
  v_month numeric;
  b bookings;
begin
  perform pg_advisory_xact_lock(20261218);            -- one checkout at a time: no double selling
  perform wv_release_expired();

  select array_agg(t.seat order by t.seat) into v_taken
    from tickets t
   where t.seat in (select x->>'seat' from jsonb_array_elements(p_seats) x);
  if v_taken is not null then
    raise exception 'SEAT_TAKEN:%', array_to_string(v_taken, ',');
  end if;

  v_month := wv_online_month_total();
  if p_month_cap is not null and v_month + p_amount > p_month_cap then
    raise exception 'ONLINE_LIMIT:%', greatest(p_month_cap - v_month, 0);
  end if;

  insert into bookings (ref, access_key, status, channel, amount, seats, customer, expires_at)
  values (p_ref, p_access_key, 'pending', 'online', p_amount, p_seats, p_customer,
          now() + make_interval(mins => p_hold_minutes))
  returning * into b;

  insert into tickets (ticket_id, booking_ref, seat, row_letter, seat_num, tier, price)
  select p_ref || '-' || (x->>'seat'), p_ref, x->>'seat', x->>'row', (x->>'num')::int, x->>'tier', (x->>'price')::numeric
    from jsonb_array_elements(p_seats) x;

  return wv_booking_json(b);
end $$;

-- ---------- 2. PayHere's confirmation (already signature-checked by the server) ----------
create or replace function public.wv_apply_payment(
  p_ref text, p_status_code int, p_amount numeric, p_currency text,
  p_payment_id text, p_method text, p_message text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  perform pg_advisory_xact_lock(20261218);
  select * into b from bookings where ref = p_ref for update;
  if not found then raise exception 'NO_BOOKING'; end if;

  -- the amount paid must be exactly what we asked for
  if p_amount is distinct from b.amount or upper(p_currency) is distinct from upper(b.currency) then
    update bookings set status_message = format('AMOUNT_MISMATCH paid %s %s', p_amount, p_currency), updated_at = now()
     where ref = p_ref;
    raise exception 'AMOUNT_MISMATCH';
  end if;

  if p_status_code = 2 then                           -- success
    if b.status = 'paid' then return wv_booking_json(b); end if;   -- PayHere may notify twice
    if b.status in ('expired','cancelled','failed') then
      -- paid after the hold ran out: take the seats back if nobody else has them
      begin
        insert into tickets (ticket_id, booking_ref, seat, row_letter, seat_num, tier, price)
        select p_ref || '-' || (x->>'seat'), p_ref, x->>'seat', x->>'row', (x->>'num')::int, x->>'tier', (x->>'price')::numeric
          from jsonb_array_elements(b.seats) x
        on conflict (ticket_id) do nothing;
      exception when unique_violation then
        update bookings set status = 'paid_conflict', payment_id = p_payment_id, payment_method = p_method,
               status_message = 'Paid after hold expired and a seat was resold. Refund or re-seat.', paid_at = now(), updated_at = now()
         where ref = p_ref returning * into b;
        return wv_booking_json(b);
      end;
    end if;
    update bookings set status = 'paid', payment_id = p_payment_id, payment_method = p_method,
           status_message = p_message, paid_at = now(), updated_at = now()
     where ref = p_ref returning * into b;

  elsif p_status_code in (-1, -2) then                -- cancelled / failed
    if b.status = 'pending' then
      update bookings set status = case when p_status_code = -1 then 'cancelled' else 'failed' end,
             status_message = p_message, updated_at = now()
       where ref = p_ref returning * into b;
      delete from tickets where booking_ref = p_ref;
    end if;

  elsif p_status_code = -3 then                       -- chargeback
    update bookings set status = 'chargedback', status_message = p_message, updated_at = now()
     where ref = p_ref returning * into b;
  end if;                                             -- 0 = still pending: nothing to do

  return wv_booking_json(b);
end $$;

-- buyer closed the PayHere popup without paying: free the seats straight away
create or replace function public.wv_cancel_pending(p_ref text, p_access_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  perform pg_advisory_xact_lock(20261218);
  update bookings set status = 'cancelled', status_message = 'Closed payment window', updated_at = now()
   where ref = upper(p_ref) and access_key = p_access_key and status = 'pending'
  returning * into b;
  if found then delete from tickets where booking_ref = b.ref; end if;
  return case when b.ref is null then null else wv_booking_json(b) end;
end $$;

-- ---------- 3. reading bookings ----------
create or replace function public.wv_taken_seats() returns text[]
language plpgsql security definer set search_path = public as $$
begin
  perform wv_release_expired();
  return coalesce((select array_agg(seat) from tickets), '{}');
end $$;

create or replace function public.wv_get_booking(p_ref text, p_access_key text) returns jsonb
language sql security definer set search_path = public as $$
  select wv_booking_json(b) from bookings b where b.ref = upper(p_ref) and b.access_key = p_access_key;
$$;

-- buyer lookup on another phone: booking number + last 7 digits of the phone must match
create or replace function public.wv_lookup_booking(p_ref text, p_phone_tail text) returns jsonb
language sql security definer set search_path = public as $$
  select wv_booking_json(b) || jsonb_build_object('access_key', b.access_key)
    from bookings b
   where b.ref = upper(p_ref)
     and b.status in ('paid','cash','paid_conflict')
     and right(regexp_replace(b.customer->>'phone', '\D', '', 'g'), 7) = right(regexp_replace(p_phone_tail, '\D', '', 'g'), 7);
$$;

create or replace function public.wv_staff_bookings() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(wv_booking_json(b) order by b.created_at desc), '[]'::jsonb)
    from bookings b where b.status not in ('expired','cancelled','failed');
$$;

-- ---------- QR verification (public page): only what's needed to confirm a ticket ----------
create or replace function public.wv_verify_ticket(p_ticket_id text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'ticketId', t.ticket_id, 'seat', t.seat, 'row', t.row_letter, 'num', t.seat_num, 'tier', t.tier,
    'status', b.status, 'checkedInAt', t.checked_in_at, 'ref', b.ref,
    'name', trim(coalesce(b.customer->>'first','') || ' ' || left(coalesce(b.customer->>'last',''), 1) || '.'))
  from tickets t join bookings b on b.ref = t.booking_ref
  where t.ticket_id = upper(trim(p_ticket_id));
$$;

-- ---------- confirmation email ----------
create or replace function public.wv_email_payload(p_ref text) returns jsonb
language sql security definer set search_path = public as $$
  select wv_booking_json(b) || jsonb_build_object('access_key', b.access_key) from bookings b where b.ref = upper(p_ref);
$$;

create or replace function public.wv_mark_email_sent(p_ref text) returns void
language sql security definer set search_path = public as $$
  update bookings set email_sent_at = now(), updated_at = now() where ref = upper(p_ref);
$$;

-- ---------- 4. door check-in ----------
create or replace function public.wv_check_in(p_ticket_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t tickets; b bookings;
begin
  select * into t from tickets where ticket_id = upper(trim(p_ticket_id)) for update;
  if not found then return jsonb_build_object('result','missing'); end if;
  select * into b from bookings where ref = t.booking_ref;
  if b.status not in ('paid','cash') then
    return jsonb_build_object('result','unpaid','booking', wv_booking_json(b));
  end if;
  if t.checked_in_at is not null then
    return jsonb_build_object('result','already','booking', wv_booking_json(b), 'ticketId', t.ticket_id);
  end if;
  update tickets set checked_in_at = now() where ticket_id = t.ticket_id;
  return jsonb_build_object('result','ok','booking', wv_booking_json(b), 'ticketId', t.ticket_id);
end $$;

create or replace function public.wv_undo_check_in(p_ticket_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  update tickets set checked_in_at = null where ticket_id = upper(trim(p_ticket_id));
  select bk.* into b from bookings bk join tickets t on t.booking_ref = bk.ref where t.ticket_id = upper(trim(p_ticket_id));
  return wv_booking_json(b);
end $$;

-- ---------- 5. seats sold at the school office (cash) ----------
create or replace function public.wv_record_cash_sale(p_ref text, p_access_key text, p_amount numeric, p_seats jsonb, p_customer jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_taken text[]; b bookings;
begin
  perform pg_advisory_xact_lock(20261218);
  perform wv_release_expired();
  select array_agg(t.seat order by t.seat) into v_taken from tickets t
   where t.seat in (select x->>'seat' from jsonb_array_elements(p_seats) x);
  if v_taken is not null then raise exception 'SEAT_TAKEN:%', array_to_string(v_taken, ','); end if;
  insert into bookings (ref, access_key, status, channel, amount, seats, customer, paid_at)
  values (p_ref, p_access_key, 'cash', 'cash', p_amount, p_seats, p_customer, now()) returning * into b;
  insert into tickets (ticket_id, booking_ref, seat, row_letter, seat_num, tier, price)
  select p_ref || '-' || (x->>'seat'), p_ref, x->>'seat', x->>'row', (x->>'num')::int, x->>'tier', (x->>'price')::numeric
    from jsonb_array_elements(p_seats) x;
  return wv_booking_json(b);
end $$;

-- Only the server (service role / secret key) may call these.
revoke all on all functions in schema public from anon, authenticated, public;
grant  execute on all functions in schema public to service_role;
grant  all on public.bookings, public.tickets to service_role;
