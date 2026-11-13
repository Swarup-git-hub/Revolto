# Implementation audit

Audited artefact: `revolto__reviewslot_holiv1.zip` (no Git repository; `node_modules` and a built `frontend/dist` were inside the zip). The zip also contained a **`backend/.env` with real-looking credentials (JWT secret, Gmail app password)** and `frontend/.env.local`. Values were not printed or copied; **rotate those credentials** (they now exist in your zip history) and do not commit them.

## 1. Facts about the original (verified)

| Item | Result | How verified |
|---|---|---|
| Stack | Express 4 · Mongoose · Socket.IO · Nodemailer · node-cron · ExcelJS / React 18 · Vite · Tailwind · zustand · axios · react-router 6 | `package.json`, source |
| Roles | `student`, `guide`, `admin` only. No coordinator, no sections | `models/User.js` |
| Existing tests | **None** (no test files or framework) | file scan |
| Frontend build | Succeeds (`vite build`) | ran it |
| Backend boot | Boots against MongoDB; email not configured without creds | ran it against a local MongoDB 8 replica set |
| `npm run seed` equivalent (`src/seed.js`) | **Crashes**: `Slot validation failed: slotIndex is required` | ran it |
| Public (no token) routes | `GET /api/config` → 200; `GET /api/slots/session/:id` → 200; `GET /api/requests/:id` and `/api/teams/:id` reachable without auth | ran probes |
| OTP verification attempts | **Unlimited**: 25 wrong guesses all processed | ran probe |
| OTP exposure | Code returned to the client as `_devOtp` and written to the server log in dev mode (5 log lines in the probe) | ran probe |
| OTP resend limit | Counter never reset except on successful login ⇒ accounts lock out permanently after the 4th–5th request (200,200,200,200,429,429) | ran probe |
| OTP storage / generation | Plain text in the user document; `Math.random()` | source |
| Audit logging | `utils/helpers.js` calls `require()` inside an ES module → every audit write fails silently | source + `node --check` / reasoning |
| Background jobs | Reminder job references an undefined variable and an invalid `populate` path → cannot work; reminders are a future-phase item anyway | source |
| Booking rules | Slot = one date with 10 fixed slots; approve used MongoDB **transactions** (need a replica set); 30-min config. The 8 PM / 1–3 h rules in `TODO.md` are **not in the code** | source + `grep` |
| `TODO.md`, `IMPLEMENTATION_COMPLETE.md`, … (5 docs, ~1,900 lines) | Claim HTTP-only cookies, CSRF, Review/Upload models, an 8 PM cut-off, etc. **None exist in the code** | source vs docs |
| Sockets | Unauthenticated; user objects broadcast to every client | source |
| Other | `PATCH /api/config` copies arbitrary body fields; `$regex` built from raw search input; student self-join; email sending after save without error handling; a hard-coded personal email in `seedTeam.js`; `seed.js` deletes all collections without a guard | source |
| File uploads / PDF export / review submissions / sections / imports | **Absent** | source |

## 2. Requirement matrix

Status values describe the **original** code. “After” is the state of this delivery (details in `REQUIREMENTS_TRACEABILITY.md`).

| Requirement | Status (original) | Evidence | Risk / gap | Proposed action | Depends on | After |
|---|---|---|---|---|---|---|
| Roles Student/Guide/Coordinator/HOD | Partial | `User.role` has admin instead of HOD; no coordinator | No section scope | Add roles; map admin→HOD by migration | Sections | Implemented |
| Server-side scope per role/team/section | Broken | public team/request/slot/config routes; guides could list all students | Data exposure | Central scope filter, tests | Roles | Implemented |
| Mass-assignment protection | Broken | `PATCH /config`, user create takes arbitrary role/team | Privilege escalation | Whitelist validators | — | Implemented |
| Admin override logging | Broken | audit helper uses `require` in ESM | No audit trail | Rewrite audit service | — | Implemented |
| Team ID, membership, central title | Partial | Team had `name`/members; no title workflow | No explicit ID/leader/title history | Add `teamId`, leader, title history | Sections | Implemented |
| Configurable team size / guide load / section capacity | Partial | Config model existed with conflicting defaults (max students 5 in `Config`, 4 in `Team`) | Unreliable limits | `Settings` + enforcement | — | Implemented |
| Bulk import (template, preview, validate, duplicates, confirm) | Missing | — | Manual data entry | Students/teams/staff importers | Sections | Implemented |
| Archive instead of delete | Partial | hard deletes existed for users/teams | History loss | Archive/restore only | — | Implemented |
| Review 1–4 sequence, configurable | Missing | no review models | Core feature absent | `ReviewConfig` + defaults + per-section copy | Sections | Implemented |
| Review 1 title workflow + change history | Missing | — | — | Submission + guide decision + title history | Review model | Implemented |
| Review 2 team progress + individual contribution + history | Missing | — | — | Submissions, contributions, versions | Review model | Implemented |
| Review 3 structured fields + compare to Review 2 | Missing | — | — | Structured submission + comparison endpoint | Review 2 | Implemented |
| Review 4 final report (PDF, versions, statuses) | Missing | no upload code | — | Multipart upload with type/size/signature checks | Storage | Implemented (local disk) |
| Slot booking independent from reviews; HOD/Coordinator policy | Partial | booking was the whole app; one global config | Cannot disable per section | Policy hierarchy | Settings | Implemented |
| Manual + date-range slot generation, preview, validation | Missing | fixed 10 slots/day grid | — | Generator with preview and conflict checks | Policy | Implemented |
| No double booking (concurrent) | Partial | transactions need replica set; multiple pending per slot | Races on standalone DB | Atomic claim + partial unique indexes | — | Implemented, tested concurrently |
| Guide approves; Coordinator/HOD audited override | Partial | admin override model existed, not audited | — | `/override` with reason + audit | Audit | Implemented |
| Legacy booking rules (10/day, 2×5, 1–3 h, 8 PM) | Unverified | only in docs | Hard-coding unverified rules | Make configurable; do not hard-code | — | Configurable (see ARCHITECTURE) |
| Role dashboards, timeline, separate progress measures | Partial | booking-centric dashboards, much dead UI | — | New role-aware UI | Reviews | Implemented |
| Clay design, subtle palette, accessible status labels | Missing | purple theme | — | Design system | — | Implemented |
| Excel (2 sheets) / CSV exports, scoped, with filters + timestamp | Partial | booking Excel/CSV only | Wrong content | Team/student reports | Reviews | Implemented |
| PDF export of reports | Missing | none existed | — | not required in this phase | — | Not implemented (report *uploads* are PDFs) |
| OTP login policy (6 digits, 5 min, bounded resend) | Partial/Broken | see facts | brute force, lock-out, leakage | Harden | Mail | Implemented, tested |
| No OTP/secret logging | Broken | dev OTP logged/returned | — | Remove | — | Implemented |
| Upload validation | Missing | — | — | size/ext/signature/random names/path safety | — | Implemented |
| Safe error handling | Partial | — | stack info in dev replies | central handler | — | Implemented |
| Notifications (OTP, booking) | Implemented | `mailService` | in-app UI was dead code | Keep emails; rewire in-app bell | — | Implemented |
| Scheduled reminders / messaging automation | Broken | cron jobs | Out of scope | Remove broken jobs | — | Removed (future phase) |
| Advanced analytics | Present (basic) | analytics routes/page | Out of scope this phase | Remove | — | Removed (future phase) |
| Tests | Missing | — | — | node:test suites | — | 47 backend + 13 browser flows |
| Documentation | Broken (inaccurate) | 5 overclaiming docs | Misleading | Replace | — | Replaced |

## 3. Removal / clean-up summary

Replaced rather than patched: all 9 controllers + routes, 6 old booking/session models, `Config`, `Override`, `backgroundJobs`, `notificationService`, `helpers`, both seed scripts, the 5 status documents + `TODO.md`, the frontend `features/`, `store/*Store`, `workflow/*`, `slot/*`, legacy `pages/*`, layouts and unused hooks, plus the committed `frontend/dist`, `.vscode`, `.env`, `.env.local`. The original zip is unchanged, so anything can be recovered from it.
