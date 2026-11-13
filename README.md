# Review Management System

Project progress, review and final-report management for college project reviews, with an **optional** review-slot booking module.
Built with **Node.js (ES modules) · Express · MongoDB/Mongoose · Socket.IO · React 18 · Vite · Tailwind**. JavaScript only (no TypeScript).

| Role | Can do |
|---|---|
| **Student** | See own team, submit as team leader (Review 1–4), record own contribution, read Guide feedback, request slots when booking is on |
| **Guide** | Review/approve/request changes for assigned teams (any section), confirm or edit titles (with reason), approve slot requests, create own slots |
| **Coordinator** | Manage students/teams/reviews/slots/booking policy **for assigned sections only**, override bookings with an audited reason, export |
| **HOD** | College-wide monitoring and configuration, sections, staff, settings, audit log |

## Quick start (development)

Requirements: **Node ≥ 20.19**, **MongoDB ≥ 5.0** you can reach (local or Atlas).

```bash
# 1. install
npm run install:all

# 2. configure the API
cp backend/.env.example backend/.env       # then edit: MONGO_URI, JWT_SECRET (>=32 chars)
#    For local development without email, set DEV_FIXED_OTP=123456 (refused in production)

# 3. create the first HOD (set HOD_EMAIL in backend/.env first)
npm --prefix backend run bootstrap:hod
#    optional demo data (never runs in production): npm --prefix backend run seed:demo

# 4. run
npm --prefix backend run dev       # API    http://localhost:5000
npm --prefix frontend run dev      # UI     http://localhost:5173  (proxies /api and /socket.io)
```

Sign in with the account's email; the 6-digit code arrives by email (or is your `DEV_FIXED_OTP` in development).

## Scripts

| Command | Purpose |
|---|---|
| `npm test` | Backend test suite (needs a MongoDB; see `docs/TEST_REPORT.md`) |
| `npm run build` | Production build of the frontend (`frontend/dist`) |
| `npm --prefix backend run verify:deployment` | Read-only environment check (config, MongoDB, indexes, counters, uploads, mail, scanner, Redis): run it against staging/Atlas |
| `npm --prefix backend run check:consistency` | Read-only data invariants check (teams/leaders, counters, bookings, submissions) |
| `npm --prefix backend run reconcile:counters` | Recompute seat and guide-workload counters (also done at every start) |
| `npm --prefix backend run retry:emails` | Re-send failed notification emails (e.g. from cron) |
| `npm --prefix backend run migrate:v2` … | Upgrade a v1 database (dry-run by default). See `docs/MIGRATION.md` |

## Configuration (backend/.env — placeholders only in `.env.example`)

`MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` (Gmail *app password*), `OTP_*` limits, `UPLOAD_DIR`, `HOD_EMAIL`. Frontend: optional `VITE_API_URL` for production.

## Production notes

* Serve `frontend/dist` from any static host / reverse proxy and route `/api` and `/socket.io` to the API. Set `NODE_ENV=production` (the API then refuses short secrets and `DEV_FIXED_OTP`).
* **Email is mandatory in production.** `GMAIL_USER` and `GMAIL_APP_PASSWORD` must be set or the API refuses to start (sign-in codes are emailed). If sending fails the user gets a clear error and no unusable code is left behind.
* Uploaded files are stored on local disk (`UPLOAD_DIR`, checked for write access at boot) with random names and served only through authorised API calls. Use a **persistent volume**; with several API instances use shared storage. Optional antivirus hook: `UPLOAD_SCANNER_*`.
* Rate limiting is built in (per client IP, per instance). Set `TRUST_PROXY` to the number of proxies in front of the API. Limits are generous by default because a campus often shares one public IP.
* Several API instances: set `REDIS_URL` so realtime hints reach every instance (needs Redis). A single instance needs nothing.
* Probes: `GET /api/health` (alive) and `GET /api/health/ready` (database + upload directory).
* MongoDB transactions are **not** required: double-booking, seat-capacity and guide-workload limits rely on atomic updates plus partial unique indexes.
* Upgrading from 2.0? See the second half of `docs/MIGRATION.md`.

## Documentation

`docs/ARCHITECTURE.md` · `docs/BUG_FIX_CHANGELOG.md` · `docs/BUG_FIX_IMPLEMENTATION_PLAN.md` · `docs/USER_GUIDE.md` · `docs/IMPLEMENTATION_AUDIT.md` · `docs/REQUIREMENTS_TRACEABILITY.md` · `docs/TEST_REPORT.md` · `docs/MIGRATION.md`
