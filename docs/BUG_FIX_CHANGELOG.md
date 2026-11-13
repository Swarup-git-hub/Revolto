# Bug-fix changelog: release 2.1.0

Baseline before any change: **47/47 backend tests, frontend build OK.** After: **141/141 backend tests, build OK, 15/15 browser flows (3 consecutive runs), 0 npm advisories, database consistency check: 0 violations.**
Each fix was written test-first where practical, and each concurrency fix was **mutation-checked** (the fix was deliberately broken to prove the tests fail, then restored).
Existing tests: no assertion was removed or loosened. Exactly one pre-existing assertion was changed (student-CSV header, to include the new contribution columns); new tests were added around it.

## Outcome classification

### Fixed and verified (tests against a real MongoDB; browser where relevant)
| # | Finding | Evidence of verification |
|---|---|---|
| F1–F3 | OTP: unsent email reported as success; no production SMTP validation; failed delivery left an unusable code and burned cooldown/budget | `otp-delivery.test.js` (9). Red run before the fix: 5 failing. Mutation: removing the rollback → 3 fail |
| F4 | Notification email results ignored; no tracking; SMTP latency blocked requests | `notifications.test.js` (10); mutation: blocking send → "approval doesn't wait for SMTP" fails |
| F5–F7 | Section capacity race; import confirm ignored capacity; transfer/restore inconsistent | `capacity.test.js` (13) incl. 8 parallel creations for one seat; mutation (check-then-act) → 4 fail |
| F8 | Guide workload race (create/reassign/restore/import) | `workload.test.js` (11); mutation → 3 concurrency tests fail |
| F9 (+archive) | Removing the leader left the team leaderless | `leader.test.js` (9) + browser flow; mutation (old behaviour) → 7 fail |
| F10–F11 | Review filter fallback; contribution export had no content | `reports-accuracy.test.js` (11); mutation (fallback) → 2 fail |
| F12 | Silent truncation (dashboard 2,000; People/Teams 200; slots 500; requests 300) | `pagination.test.js` (8): 260 users, 360 teams, 650 slots, 360 requests, 2,456 teams on the dashboard (≈0.6 s); browser pagination for People and Teams |
| F13 (part) | Rate limiting; readiness probe; secure download headers + traversal; upload scanner hook + quarantine; fail-fast Redis; read-only deployment checker | `hardening.test.js` (14), `consistency.test.js` (3) |
| F13 (part) | Multi-instance Socket.IO | `socket-redis.test.js` (3): two separate API processes + real Redis; control instance without the adapter receives nothing |
| F14 | Destructive buttons rendered unstyled (`btn-danger` purged from the CSS) | build output check + browser assertion on the computed style |
| (new) | Coordinator dashboard counted 0 teams: a regression introduced *by this release's own rewrite* (aggregation does not cast string ids) and caught by its tests before delivery | `pagination.test.js` test 1 |

### Fixed but not integration-tested
| Item | What was and was not tested |
|---|---|
| Email delivery (OTP and notifications) | Failure/success paths are tested with a simulated SMTP (accept, reject, slow, unconfigured). **Real Gmail was not available.** |
| Upload scanner | Tested with a stand-in executable that follows the documented exit-code contract (clean/infected/error/timeout/missing binary). **Real ClamAV was not run.** |
| Redis adapter | Real Redis 8 (single node, no TLS, no auth). `rediss://` / managed Redis not tested |
| Booking list pagination UI | API tested above 500/300 records; browser pagination was exercised on People and Teams, not on the Bookings screens |
| Rate limiting across instances | Counters are in-memory per instance (documented); a shared store was deliberately not added |

### Still unresolved (found while verifying; not changed because they need a product decision or are low risk)
1. **Guide reassignment leaves existing booking requests with the previous guide.** Requests and their slots belong to the old guide, so the new guide cannot approve a *pending* request of a reassigned team (HOD/Coordinator can override). Needs a decision: move/cancel those requests on reassignment, or leave as is.
2. Counters (`Section.studentCount`, `User.activeTeamCount`) can still drift if the process crashes between "reserve" and "create", or if someone edits users/teams directly in MongoDB. Mitigated: reconciled at every server start, `npm run reconcile:counters`, `POST /api/sections/reconcile`, and detected by `npm run check:consistency`.
3. Exports and the guide review queue are not paginated or streamed (bounded by scope; fine to thousands of rows, not tens of thousands).
4. Failed notification emails are retried only when `npm run retry:emails` is run (e.g. from cron); no scheduler was added (scheduled messaging is out of scope).

### Deferred by product decision (not treated as defects)
PDF report export · advanced analytics · scheduled reminders / messaging automation · more than one pending booking per team per review · who may edit a project title (Guide/Coordinator/HOD yes, students no; changing this needs approval).
Not applicable to this codebase: "Deep Violet" design and "HOD favorites" do not exist here (verified by search); nothing was changed for them.

### Blocked by external services
**MongoDB Atlas staging verification** (no Atlas access from this environment). Provided instead: `npm run verify:deployment`, a read-only checker (config, MongoDB ≥ 5.0, safety indexes, counters, uploads, mail, scanner, Redis), tested against a local database, to be run against Atlas with the staging environment variables. Also unverified: real SMTP, real ClamAV, managed Redis.

## Changes by batch

### Batch 1: OTP delivery
Files: `shared/mail.js`, `modules/auth/auth.service.js`, `config/env.js` · Tests: `otp-delivery.test.js`
* `sendMail` now **throws** on failure/unconfigured instead of returning `false`; SMTP timeouts added (10 s).
* `requestOtp`: unconfigured mail → HTTP 503 *before* the user lookup (same answer for known and unknown addresses); delivery failure → previous OTP state restored exactly, HTTP 503; unknown email still gets the generic 200. `DEV_FIXED_OTP` needs no mail (non-production only).
* `assertEnv` (now unit-testable) requires `GMAIL_USER`/`GMAIL_APP_PASSWORD` in production.
* Trade-off: when SMTP rejects one specific address, only that registered address gets a 503 (a small enumeration signal limited to a broken-SMTP situation).

### Batch 2: Notification delivery
Files: `shared/notify.js`, `models/Notification.js`, `modules/bookings/bookings.routes.js`, new `scripts/retry-failed-emails.js` · Tests: `notifications.test.js`
* Per-notification `email {status, attempts, lastAttemptAt, lastError}`; failures logged with ids only (no address/content); emails sent in the background; `retryFailedEmails()` re-sends existing records atomically (max 3 attempts); optional `dedupeKey` (unique per recipient) used for booking events.

### Batch 3: Section capacity
Files: `models/Section.js`, `modules/sections/capacity.js`, `shared/counters.js`, `modules/users/users.routes.js`, `modules/imports/imports.service.js`, `modules/sections/sections.routes.js`, `server.js` · Tests: `capacity.test.js`
* One mechanism (`reserveSeat` / `releaseSeat` / `createStudentWithSeat`) for create, import confirm, transfer, archive, restore and role change; atomic `studentCount < capacity` update; released on any failure.
* Design finding: the counter fields have **no schema default**. A default would be written back by `save()` on legacy documents and silently reset the count (found by a test).

### Batch 4: Guide workload
Files: `modules/teams/teams.service.js`, `teams.routes.js`, `imports.service.js`, `models/User.js` · Tests: `workload.test.js`
* `reserveGuideSlot` / `releaseGuideSlot` on `User.activeTeamCount`; used by create, reassign, restore, import; archive and reassign-away release. The configured maximum is never changed and nothing is reassigned silently.

### Batch 5: Team leader removal
Files: `teams.service.js`, `teams.routes.js`, `users.routes.js`, `frontend/src/pages/TeamDetail.jsx`, `components/ui/index.jsx` · Tests: `leader.test.js` + browser flow
* `DELETE /api/teams/:id/members/:studentId?replacementLeaderId=…` (required when removing the leader). Leader switches first; sole-member leader cannot be removed; audit + notifications; archiving a student who leads an active team is refused. Who may remove members is unchanged.

### Batch 6: Report accuracy
Files: `reports.service.js`, `reports.routes.js`, `progress.service.js` · Tests: `reports-accuracy.test.js`
* Exact review match, 400 for unknown review keys, excluded-team note in CSV/Excel context. Student export gains **Contribution review / summary / tasks** (status and version count stay separate; the word "verified" never appears). Empty filtered exports keep their header row.

### Batch 7: Pagination and completeness
Files: `dashboard.routes.js`, `bookings.routes.js`, `frontend`: `Pager`, `People.jsx`, `Teams.jsx`, `Bookings.jsx`, `Sections.jsx` · Tests: `pagination.test.js`
* Dashboard summary = one streamed aggregation (no cap, no history loading). `/bookings/slots` and `/bookings/requests` paginate (`page`, `limit`, `total`); scope is applied in the query. Requires **MongoDB ≥ 5.0**.

### Batch 8: Production hardening
Files: `app.js`, `config/env.js`, `shared/upload.js`, `shared/socket.js`, `server.js`, `reviews.routes.js`, new `scripts/verify-deployment.js`, `scripts/reconcile-counters.js`, `shared/consistency.js`, `scripts/check-consistency.js` · Tests: `hardening.test.js`, `socket-redis.test.js`, `consistency.test.js`, `slot-race.test.js`
* **Rate limiting** (`express-rate-limit`): general, sign-in, exports, uploads; probes exempt. Defaults are deliberately generous because a campus usually shares one public IP.
* **Readiness**: `GET /api/health/ready` (database + writable upload directory).
* **Uploads**: writability checked at boot; downloads get `nosniff`, sandbox CSP, `no-store`; path traversal refused. Optional scanner hook with quarantine and a fail-closed switch.
* **Multi-instance**: optional Redis adapter (`REDIS_URL`), fails fast at startup if Redis is unreachable.
* **Dependencies**: `npm audit` reports 0 for backend (production and dev) and frontend. New runtime dependencies: `express-rate-limit`; optional: `@socket.io/redis-adapter`, `redis`; dev: `socket.io-client`.
* **Not added (operational cost explained):** a cloud object-storage driver, a shared rate-limit store, a managed antivirus service.

## API and contract changes
| Change | Detail |
|---|---|
| `POST /auth/send-otp` | may now return 503 (email unavailable / delivery failed) |
| `DELETE /teams/:id/members/:studentId` | `?replacementLeaderId=` required when removing the leader |
| `GET /bookings/slots`, `GET /bookings/requests` | now return `total`, `page`, `limit`; default page sizes 100 / 50 (max 200) |
| `GET /exports/*` | unknown `review` → 400; student CSV/Excel has 3 new columns |
| `POST /sections/reconcile` | new, HOD only |
| `GET /health/ready` | new, unauthenticated |
| Upload responses | 422 (failed scan), 503 (scanner required but unavailable) |
