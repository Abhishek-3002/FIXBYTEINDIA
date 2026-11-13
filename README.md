# FIXBYTE INDIA — CMADD Medical Partner Verification

This repository powers the FIXBYTE INDIA Connected Medical Partner Program for Choudhary Medical & Drug Distributors (CMADD).

## What the platform does
- FIXBYTE-only admin dashboard (CMADD has no separate admin login/dashboard).
- Manual medical-store registration and CMADD connection status management.
- Manual purchase-bill entry, including paid, credit and partial-payment bills.
- Four-consecutive-calendar-day eligibility cycles: ₹12,000 net valid purchases earn one ₹99 static-website reward.
- Returns are linked to the original sale bill and reduce that sale's eligibility cycle.
- Cancelled bills are excluded and retained in the audit history.
- One permanent partner card per store; repeat rewards attach to the same card.
- Public QR verification page at `/verify.html?token=...`.
- ₹99 static website order tracking.
- Admin audit log; no customer/store delete controls.

## Stack
- Static HTML/CSS/JavaScript frontend.
- Vercel serverless Node.js API functions in `/api`.
- Supabase PostgreSQL using the server-side service-role key only.
- HMAC-signed HttpOnly admin session cookie.

## Setup

### 1. Supabase
1. Create a Supabase project.
2. Open SQL Editor.
3. Run all SQL in `database/verification-schema.sql`.
4. Copy the project URL and service-role key. Never put the service-role key in frontend code or commit it to GitHub.

### 2. Environment variables
Set these in Vercel Project → Settings → Environment Variables (Production, Preview and Development as needed):

- `SUPABASE_URL` — Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service-role secret (server only).
- `FIXBYTE_ADMIN_USERNAME` — choose the admin username.
- `FIXBYTE_ADMIN_PASSWORD` — choose a strong, unique admin password.
- `FIXBYTE_SESSION_SECRET` — random secret of at least 32 characters.

Do not commit real credentials. `.env.example` contains placeholders only.

### 3. Deploy
- Set the Vercel project root to this repository.
- Framework preset: Other.
- Build command: leave empty.
- Output directory: leave empty / project root.
- Deploy the `medical-verification-platform` branch as Preview first.
- After configuring environment variables and completing tests, merge to the production branch and deploy.

## Admin and public pages
- Public program website: `/`
- Admin dashboard: `/admin.html`
- QR verification: `/verify.html?token=...`

## Important business rules
- A cycle begins with the first valid sale bill after the prior cycle closes and lasts four calendar days.
- Each valid bill number is unique per medical store.
- Paid, credit and partial bills count equally.
- A return must reference its original sale bill; it is deducted from that original cycle.
- Cancelled bills remain in the database and are excluded from totals.
- Once ₹12,000 is reached, that cycle earns one reward. Further bills on the same qualifying date stay in that cycle; a later-date bill starts the next cycle.
- Extra amount does not roll forward.
- CMADD connection status is manually controlled by FIXBYTE Admin. Inactive connection blocks offer redemption but does not erase card history.
- A post-qualification return that reduces the total below ₹12,000 flags the reward for review.

## Security notes
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in browser JavaScript.
- Use HTTPS in production.
- Rotate any credentials that were previously committed to a public repository.
- Keep database backups enabled in Supabase.
