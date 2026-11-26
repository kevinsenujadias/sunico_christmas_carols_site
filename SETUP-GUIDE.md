# Winter Vespers – setup guide

> **Payments now use BANK TRANSFER** (see the next section). PayHere is switched off and only comes back if
> `PAYMENT_METHODS` is set to `payhere` or `bank,payhere`. The PayHere steps further down are kept for that case.

## Bank transfer: how it works

1. The buyer picks seats → **Reserve seats**. The seats turn red for everyone and are held for **24 hours** (`BANK_HOLD_HOURS`).
2. My Tickets shows the school's bank details, the **exact amount** and the **booking number** (e.g. `WV-7K3QX9`) to write in the transfer remarks, with copy buttons.
3. The buyer transfers and uploads a photo/PDF of the slip. Slips go to a **private** Supabase Storage bucket (`slips`).
4. Staff open **Staff check-in → Bank transfers to confirm**, check the school bank app for that amount + booking number, and press **Approve**.
   The tickets (with QR codes) appear on the buyer's phone and are emailed (if Brevo is set up).
5. **Reject** (with a reason) releases the seats. No slip after 24 hours → seats released automatically.
   A slip was sent → seats stay held until staff approve or reject. Late money can still be approved if the seats are free.
6. Limits against seat-hoarding: max 2 unpaid transfers per phone/email, 6 per internet address, 10 seats per booking.

### The school's bank account
Sampath Bank · Gampaha (16) · Sumedha Noble International College (Pvt) Ltd. · 001610011051

These are written in the server code (`netlify/lib/http.mjs`, `SCHOOL_BANK`), **not** in a Netlify setting,
so they can only be changed by a code change pushed to GitHub. Nobody can change them from the website or a browser.

Optional Netlify variables: `BANK_HOLD_HOURS` (default `24`), `PAYMENT_METHODS` (default `bank`), `STAFF_SESSION_HOURS` (default `12`).

### SMS (Text.lk or Notify.lk)
Parents get a text with a private link to their booking:
- slip uploaded → "slip received, we're verifying it"
- approved → "payment approved, here are your tickets"
- rejected → reason + help email
- office cash sale → ticket link (if a phone number is entered)
Staff can re-send the link from the check-in result ("Text ticket link").

**Text.lk** (used if set): Developers → API key → Netlify variable `TEXTLK_API_KEY` (tick secret).
Later, when the sender name is approved: `SMS_SENDER_ID` = `SUNICO`. Until then texts come from `TextLKDemo` (testing only).
**Notify.lk** (alternative): `NOTIFY_USER_ID`, `NOTIFY_API_KEY`, `NOTIFY_SENDER_ID`.
No SMS settings = no texts, nothing else breaks. Redeploy after adding.

### After pulling this version: run the database file again
Supabase → SQL Editor → paste all of `supabase/schema.sql` → Run. It adds the bank-transfer parts and the
private `slips` bucket, and keeps all existing bookings. Safe to run more than once.

### Security already built in
- Prices are calculated on the server; a buyer can't change the amount.
- Every QR is signed with `TICKET_SECRET`; fake or edited QRs show NOT VALID; each ticket scans once.
- Staff sign in with the PIN once and get a pass that expires (12 h). The PIN is never stored on the phone.
  8 wrong PINs from one connection lock it for 15 minutes. Changing `STAFF_PIN` signs everyone out.
- The staff page locks itself after 10 minutes without use.
- Slips: only real images/PDFs under 3 MB are accepted; staff see them through 10-minute links.
- Strict browser security headers (netlify.toml): only the site's own scripts can run.
- Database tables are locked: only the server (secret key) can read or change them.

---

# Switching on card payments (PayHere), only if ever needed

The website already works in **demo mode**. These steps switch on **real bookings + PayHere**.
Do them in order. Total time: about an hour, plus waiting up to 24 h for PayHere to approve your domain.

---

## How it works (the short version)

```
Parent's phone ──► Website (Netlify)
                     │ 1. "Pay"  → server reserves the seats for 15 min,
                     │             prices them, signs the payment with the secret key
                     ▼
                  PayHere popup ── parent pays by card / eZ Cash / etc.
                     │
                     │ 2. PayHere tells OUR SERVER directly: "order WV-XXXXXX paid"
                     ▼
            netlify/functions/payhere-notify
                     │ 3. checks PayHere's signature + the exact amount
                     ▼
                Supabase database → booking = PAID → tickets + QR codes appear
                     │
                     ▼ 4. confirmation email (Brevo): booking no., seats, a QR per ticket
```

**The QR codes.** Each ticket's QR opens an official check page, like a certificate check:
`https://winter-vespers.netlify.app/v?t=WV-XXXXXX-C4&s=…`
It shows **VALID TICKET** (green), **ALREADY USED** (amber, with the time) or **NOT A GENUINE TICKET** (red),
straight from the live records. The code at the end (`s=…`) is a signature: change one letter
or copy it onto another seat, and it says *not genuine*.

A booking is **only** marked paid when step 3 passes. Nobody can fake it from their browser.

| Piece | What it is | Cost |
|---|---|---|
| **Supabase** | The database (bookings, tickets, check-ins) | Free plan |
| **Netlify** | Hosts the website + the small server code (`netlify/functions`) | Free plan |
| **PayHere Lite** | Takes the money | No monthly fee, 3.3% per payment, max Rs. 200,000/month |
| **Brevo** | Sends the confirmation emails with the tickets | Free plan: 300 emails/day |

---

## Step 1: Supabase (the database), 10 min

1. Go to **supabase.com** and sign up (use your GitHub account).
2. **New project**
   - Name: `winter-vespers`
   - Database password: make a strong one and **save it somewhere safe**
   - Region: **Southeast Asia (Singapore)** (closest to Sri Lanka)
3. Wait about 2 minutes for it to finish setting up.
4. Left menu, **SQL Editor**, then **New query**.
5. Open `supabase/schema.sql` from this project, copy **everything**, paste it in, then click **Run**.
   You should see *"Success. No rows returned."*
6. Left menu, **Project Settings**, then **API Keys** (or **API**). Copy two things into a private note:
   - **Project URL**, like `https://abcdefgh.supabase.co`
   - **Secret key**, starting `sb_secret_…` (on older projects it's called the **service_role** key)

> ⚠️ The secret key is like the master key to the database. **Never** put it in the website code,
> GitHub, WhatsApp, or screenshots. It only goes into Netlify's settings (Step 4).

---

## Step 2: Put the new code on GitHub, 2 min

In VS Code's terminal, inside the `site` folder:

```
git add .
git commit -m "Real payments: Netlify functions + Supabase + PayHere"
git push
```

---

## Step 3: Netlify, connected to GitHub, 10 min

> From now on, update the site with `git push`, **not** drag-and-drop.
> Drag-and-drop doesn't set up the server code, so payments wouldn't work.

1. Go to **app.netlify.com**, then **Add new project** → **Import an existing project** → **GitHub**.
2. Pick the repo **`sunico_christmas_carols_site`**.
3. Build settings: leave **Build command empty**, **Publish directory** = `.`
   (`netlify.toml` already sets this.) Click **Deploy**.
4. **Project configuration** → **Change project name** → `winter-vespers`
   Your site is now **https://winter-vespers.netlify.app** (if the name is taken, pick another and use it everywhere below).

The site will still say **Demo** at this point. That's expected.

---

## Step 4: PayHere sandbox (test account), 10 min + approval wait

1. Go to **sandbox.payhere.lk** and sign up (free; it's a separate test system, no real money).
2. Side menu → **Integrations**. Copy your **Merchant ID**.
3. Click **Add Domain/App** → choose **Domain** → enter `winter-vespers.netlify.app` → **Request to Allow**.
4. Wait for approval (PayHere says **up to 24 hours**).
5. Copy the **Merchant Secret** shown next to your domain.

> The Merchant Secret belongs to that one website address. If you change the address,
> add the new one in PayHere and use its new secret.

---

## Step 4b: Brevo (confirmation emails), 10 min

1. Go to **brevo.com** and sign up (free, no card needed).
2. Add the **sender**: the address the tickets come *from*. Find **Senders** in Brevo's settings
   (menu names can move a little) → **Add a sender** → name `SUNICO Winter Vespers` + the email address
   → open the code Brevo emails to that address and verify it.
   - Best: a school address (e.g. `carols@sunico.lk`). Ask whoever runs the school's email to also
     **authenticate the domain** in Brevo so the emails don't land in spam.
   - OK for testing: a Gmail address.
3. **SMTP & API** → **API keys** → **Generate a new API key** → name it `winter-vespers` → copy it (starts `xkeysib-…`).

> If Brevo isn't set up, everything else still works. Tickets just aren't emailed.

---

## Step 5: Give Netlify the keys, 5 min

Netlify → your project → **Project configuration** → **Environment variables** → **Add a variable**.
Add each of these:

| Key | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://abcdefgh.supabase.co` | from Step 1 |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | from Step 1, **secret** |
| `PAYHERE_MERCHANT_ID` | e.g. `1221234` | from Step 4 |
| `PAYHERE_MERCHANT_SECRET` | the long secret | from Step 4, **secret** |
| `PAYHERE_SANDBOX` | `true` | `true` = test mode, `false` = real money |
| `STAFF_PIN` | at least 6 digits, e.g. `583014` | for the staff check-in page. Don't use 2026! |
| `SITE_URL` | `https://winter-vespers.netlify.app` | your exact site address |
| `TICKET_SECRET` | a long random string (30+ characters) | signs the QR codes. **Never change it after selling tickets**, or old QR codes stop working |
| `BREVO_API_KEY` | `xkeysib-…` | from Step 4b, **secret** |
| `EMAIL_FROM` | `carols@sunico.lk` | the sender you verified in Brevo |
| `EMAIL_FROM_NAME` | `SUNICO Winter Vespers` | optional |
| `EMAIL_REPLY_TO` | e.g. the office email | optional; where replies go |
| `ONLINE_MONTHLY_CAP` | `190000` | optional; stops online sales before PayHere Lite's Rs. 200,000 limit |
| `SEAT_HOLD_MINUTES` | `15` | optional; how long seats are held while someone pays |

Then **Deploys** → **Trigger deploy** → **Deploy project**. (New keys only work after a redeploy.)

✅ Open the site. You should see a yellow **"TEST MODE · payments are not real"** label,
and the checkout should say **Test mode**.

---

## Step 6: Test everything (do all of these!)

Use the test card numbers from PayHere's **Sandbox & Testing** help page (support.payhere.lk).

| Test | What should happen |
|---|---|
| Buy 2 seats with a test card | Tickets with QR codes appear. Booking number shown. |
| Check your inbox | Email with the booking number, both seats and a QR for each (check spam the first time) |
| Tap **View your tickets online** in the email on another phone | The tickets open |
| Scan a ticket QR with any phone camera | Official check page: **VALID TICKET**, row, seat, tier, "Booked by Kevin P." |
| On that page, door staff tap **Sign in** (staff PIN) → **Check in** | It changes to **ALREADY USED** with the time |
| Open the site on a second phone | Those 2 seats show as **booked (red)** |
| Pick a seat, open PayHere, then **close the popup** | "Payment cancelled". The seat is free again. |
| Supabase → **Table Editor** → `bookings` | Your booking shows `status = paid` and a PayHere `payment_id` |
| PayHere sandbox → **Payments** | The same payment is listed |
| Site footer → **Staff check-in** → your `STAFF_PIN` | All bookings listed; scanning a ticket says **Valid**, scanning again says **Already checked in** |
| Staff page → **Record an office (cash) sale** → `D1, D2` | Those seats turn red for everyone online |
| Tickets page → "Booked on another phone?" → booking no. + phone | The tickets come up |

### If something's wrong

| Problem | Fix |
|---|---|
| Site still says **Demo** | A key is missing or misspelled in Step 5, or you didn't redeploy |
| Stuck on **"Confirming your payment…"** | PayHere can't reach your server. Netlify → **Logs** → **Functions** → `payhere-notify`. Check `SITE_URL` is exactly right. |
| Log says **"Invalid signature"** | `PAYHERE_MERCHANT_ID` / `PAYHERE_MERCHANT_SECRET` don't match the domain in PayHere |
| PayHere popup says the domain isn't allowed | The domain in Step 4 isn't approved yet, or doesn't match the site address |
| No email arrives | Check spam. Netlify → Logs → Functions → `payhere-notify` shows `[email] … sent` or the error. Check `BREVO_API_KEY` / `EMAIL_FROM` (the sender must be verified in Brevo). |
| Staff need to resend tickets | Staff page → search the booking → tap the row → **Resend tickets to …** |

---

## Step 7: Going live (real money)

1. The **school** applies for a real PayHere account at **payhere.lk** (business registration + the school's bank account). Choose the **Lite** plan.
2. In the **live** PayHere account: **Integrations** → **Add Domain/App** → `winter-vespers.netlify.app` → wait for approval → copy the **live** Merchant ID + Secret.
3. In Netlify, change:
   - `PAYHERE_MERCHANT_ID`: the live one
   - `PAYHERE_MERCHANT_SECRET`: the live one
   - `PAYHERE_SANDBOX`: `false`
4. **Clear the test bookings**: Supabase → SQL Editor → run `truncate public.tickets, public.bookings;`
5. **Trigger deploy**. The yellow TEST MODE label disappears.
6. Do **one real Rs. 1,500 purchase** yourself and check it lands in the school's PayHere account.

### Upgrading to PayHere Plus later

If the school wants more than Rs. 200,000 online in a month, switch the plan to **Plus** in the PayHere portal,
then raise `ONLINE_MONTHLY_CAP` in Netlify (e.g. `2900000`) and redeploy. No code changes needed.

---

## At the door

- **Easiest:** a staff phone opens the site → **Staff check-in** → **Scan QR with camera**. Each scan checks the person in.
- **Or:** scan with the phone's normal camera. It opens the check page. The first time, tap **Sign in** with the staff PIN.
  After that, that phone shows a **Check in** button on every ticket it scans.
- **Lost phone?** Search the name / phone / booking number on the staff page and check in by hand.

---

## Where things are in the code

| File | What it does |
|---|---|
| `supabase/schema.sql` | Database tables + rules (no double-selling, monthly cap, check-in) |
| `netlify/functions/create-order.mjs` | Reserves seats, prices them, signs the PayHere payment |
| `netlify/functions/payhere-notify.mjs` | Receives PayHere's confirmation, checks the signature, marks paid |
| `netlify/functions/booking.mjs` | Loads a buyer's tickets / "find my tickets" / cancel |
| `netlify/functions/seats.mjs` | Which seats are taken |
| `netlify/functions/staff.mjs` | Staff page: list, check-in, office cash sales, resend email (needs `STAFF_PIN`) |
| `netlify/functions/verify.mjs` + `verify.html` | The page a ticket's QR opens: VALID / ALREADY USED / NOT GENUINE |
| `netlify/functions/qr.mjs` | QR images inside the emails |
| `netlify/lib/email.mjs` | The confirmation email (wording + design) |
| `netlify/lib/tickets.mjs` | Signs the QR links |
| `netlify/lib/hall.mjs` | **Seat plan + prices on the server.** Must match `js/app.js` |
| `js/api.js` | Switches the website between demo and live |
| `js/payment.js` | Opens the PayHere popup |

> If the seat plan or prices change, update **both** `js/app.js` (top of file) and `netlify/lib/hall.mjs`.
