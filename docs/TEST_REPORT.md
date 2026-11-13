# Test report (release 2.1.0)

Everything below was actually run in this environment (Linux, Node 22.22, MongoDB 8.3 single-node replica set and Redis 8 from conda-forge). Nothing is mocked: tests call the real HTTP API against a real database. Baseline before release 2.1: **47 backend tests passing**.

## Commands and results

| Check | Command | Result |
|---|---|---|
| Backend tests | `cd backend && npm test` (needs MongoDB at `MONGO_TEST_URI`, default `mongodb://127.0.0.1:27018`; Redis at `REDIS_TEST_URL`, default `redis://127.0.0.1:6390`) | **141 passed, 0 failed, 0 skipped** (~66 s); run repeatedly with identical results |
| Frontend production build | `cd frontend && npm run build` | succeeds |
| Browser flows | `sh frontend/e2e/run.sh` → `frontend/e2e/smoke.py` (Python + Playwright/Chromium) against the built UI and real API, rate limiting **enabled** | **15 passed, 0 failed**, three consecutive runs; 0 console errors; 0 HTTP 5xx |
| Database consistency after the browser flows | `npm run check:consistency` | 0 violations (1 expected warning: the bulk test data puts 42 teams on one guide, above the limit of 4) |
| Dependency audit | `npm audit` in `backend` (production + dev) and `frontend` | **0 vulnerabilities** in both |
| Migration (v1→v2) | synthetic v1 database: dry-run → apply → boot → rollback | unchanged from 2.0 (see `docs/MIGRATION.md`) |

If Redis is not reachable the three Socket.IO tests are reported as **skipped with a reason** (never silently passed).

### Backend suites (141)

| File | Tests | Covers |
|---|---|---|
| `auth.test.js` | 9 | OTP generation/hash/expiry/lock-out, enumeration, revoked tokens, role boundaries |
| `otp-delivery.test.js` | 9 | unconfigured mail, dev fixed OTP, delivery success, SMTP rejection rolls back state, no budget burn, no OTP in logs, production config validation |
| `notifications.test.js` | 10 | per-recipient tracking, safe failure logging, in-app survives email failure, approval does not wait for SMTP, retry (same records, max attempts, two workers), dedupe |
| `capacity.test.js` | 13 | enforcement, **parallel creation for the last seat**, transfer, restore, archive, role change, import re-check, failed-creation release, reconciliation, legacy sections |
| `workload.test.js` | 11 | guide limit, **parallel assignment for the last place**, reassignment, archive/restore, import re-check, failure release, reconciliation, no counter written on save |
| `leader.test.js` | 9 | leader removal rules, invalid replacements, audit and notifications, permissions unchanged, concurrency, archive guard |
| `reports-accuracy.test.js` | 11 | exact review filter, excluded-team note, invalid review, contribution content, missing contributions, status vs version separation, "never verified", formula injection, scope |
| `pagination.test.js` | 8 | 260 users, 360 teams, 650 slots, 360 requests, 2,456-team dashboard, filter+page combinations, scope on every page, dashboard equals per-team logic |
| `hardening.test.js` | 14 | rate limits (global/auth/export/upload, probes exempt), readiness, secure downloads + traversal, scanner (clean/infected/error/timeout/missing/required), `assertEnv`, `verify-deployment` (read-only, fails on missing indexes, warns on drift) |
| `socket-redis.test.js` | 3 | socket auth, **cross-instance delivery through Redis** (two processes, plus a control without the adapter), fail-fast on unreachable Redis |
| `consistency.test.js` | 3 | invariants after concurrent operations; every injected corruption detected; read-only script exit codes |
| `slot-race.test.js` | 2 | bulk-insert semantics used by slot creation; simultaneous identical generation |
| `scope.test.js` | 9 | (unchanged from 2.0) scoping, mass assignment, limits, title history |
| `reviews.test.js` | 8 | (unchanged) review lifecycle, uploads, config protection |
| `bookings.test.js` | 11 | (2.0 suite + one invariant check) booking rules and concurrency |
| `imports.test.js` | 6 | (unchanged) |
| `exports.test.js` | 5 | (unchanged except the student-CSV header assertion now lists the 3 new columns) |

Each concurrency suite also ends with a **database-invariant check** (`checkConsistency`), so the data is verified after the parallel operations, not just the responses.

### Mutation checks (fix deliberately broken, tests must fail)
| Fix | Broken as | Tests failing |
|---|---|---|
| Non-blocking notification email | send awaited again | 1 |
| Section seat reservation | check-then-act | 4 |
| Guide workload reservation | check-then-act | 3 |
| OTP rollback on failed delivery | rollback removed | 3 |
| Leader-removal rule | old behaviour (leader := null) | 7 |
| Exact review filter | silent fallback restored | 2 |
| (2.0) team scoping, atomic booking claim | scope widened; check-then-act | 3; 6 |

### Browser flows (15)
Wrong OTP · Review 1 submit · inline validation · Review 2 checklist · contribution (pending) · bookings page · guide queue/decision · title edit with reason · slot generation · all HOD pages · booking disabled · **People/Teams pagination with filters** · booking-disabled student access · **guide removes the team leader (replacement required, destructive button styled)** · 390 px mobile.

## Not tested / limitations
* **Real email delivery** (Gmail), **MongoDB Atlas**, **real ClamAV**, managed/TLS Redis: not available here. Use `npm run verify:deployment` in staging.
* Booking-list pagination was exercised through the API above 500/300 records; in the browser only People and Teams pagination was exercised.
* Chromium only; no screen-reader or automated accessibility audit; no frontend unit tests; no load tests beyond the 2,456-team dashboard (~0.6 s) and 2,100-team seed.
* Rate limits are per instance (in-memory) and the multi-instance test used a single Redis node without TLS/auth.
