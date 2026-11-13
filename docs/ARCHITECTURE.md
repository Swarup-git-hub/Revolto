# Architecture

## Layout

```
backend/src
  app.js            Express app factory (no listen / DB) – used by server.js and the tests
  server.js         boot: env check → DB → default reviews → index sync → HTTP + Socket.IO
  config/           env.js (validated settings), db.js
  models/           Mongoose schemas (one file each)
  shared/           cross-cutting code: auth, scope (authorisation), validate, errors, upload, mail, notify, audit, socket, settings, time
  modules/<feature>/  <feature>.routes.js (thin HTTP layer) + <feature>.service.js (business rules)
      auth · users · sections · teams · reviews · bookings · imports · reports · dashboard · notifications · audit · settings
backend/scripts     bootstrap-hod · seed-demo (non-prod) · migrate-v1-to-v2
backend/tests       node:test suites against a real MongoDB
frontend/src
  lib/ store/       api client, hooks, auth (sessionStorage) and toast stores
  components/ui     clay design kit (Card, Button, StatusBadge, Modal, Tabs, Async states …)
  components/reviews|bookings|layout    feature components
  pages/            role-aware pages; pages/admin for HOD/Coordinator tools
```

## Authorisation model (server-side, every route)

1. `protect` verifies the JWT **and loads the live user** (inactive users and signed-out tokens (`tokenVersion`) are refused immediately).
2. `authorize(...roles)` gates the endpoint by role.
3. **Scope** is then enforced in the query itself (`shared/scope.js`):
   `HOD → all` · `Coordinator → section ∈ user.sections` · `Guide → team.guide = me` · `Student → team = my team`.
   Out-of-scope records look like “not found” (no existence leak).
4. Writes read only explicitly validated fields (`shared/validate.js`), so `role`, `section`, `team`, `createdBy`, `tokenVersion` etc. can never be mass-assigned.
5. Leader-only actions (team submissions) and Guide-only actions (review decisions) check ownership, not just role.
6. Administrative changes, overrides, imports and exports are written to `AuditLog` (actor, role, time, before/after, reason).

## Data model

| Model | Purpose / key rules |
|---|---|
| `User` | role ∈ student/guide/coordinator/hod; students have `section` + `team` (**membership source of truth**); coordinators have `sections[]`; archived, never deleted |
| `Section` | name, capacity (null → default), optional booking overrides |
| `Settings` | single doc: team min/max size, guide max teams, section default capacity, upload defaults, title reconfirmation, booking policy, timezone |
| `Team` | explicit `teamId`, section, guide, leader, central `projectTitle` + `titleStatus` + `titleHistory[]` |
| `ReviewConfig` | review definitions (key, order, type, fields, milestones, deadline, upload rules). `section=null` is college-wide; a section copy overrides it for that section |
| `Submission` | **immutable versions** of team-level reviews (`version`, `isLatest`, `status`, `reviewHistory[]`, optional `file` metadata) |
| `Contribution` | per-student self-reported contribution versions (separate from team progress) |
| `BookingSlot` / `BookingRequest` | slots owned by a guide; requests with history. See concurrency below |
| `ImportJob` | preview rows and results of bulk imports (unconfirmed previews expire after 24 h) |
| `AuditLog`, `Notification`, `Counter` | audit trail, in-app notifications (90-day TTL), atomic team-id sequences |

Files: only metadata is in MongoDB; bytes live under `UPLOAD_DIR/<teamId>/<random>.<ext>`.

## Review lifecycle

`submit (leader) → [Submitted] → guide: Under review / Approved / Changes required → leader resubmits → new version`.
Previous versions keep their status and feedback; an undecided version replaced by a newer one becomes *superseded*.
Title (Review 1): approval sets `titleStatus=confirmed`; guide edits record old/new/actor/time/reason and (by default) require reconfirmation.
Review 2 has the team checklist (every configured milestone must be reported explicitly) **and** separate individual contributions (`pending_review` until the guide acknowledges — never labelled “verified”).
Review 3 stores structured fields and offers a read-only side-by-side with Review 2 (it never changes Review 2 statuses).
Review 4 requires a PDF by default (type, size and **file signature** are checked); an approved report is final.

**Progress indicators are never merged**: *review stages* (approved reviews / total) and *milestones* (completed / total from the latest checklist) are computed and shown separately (`reviews/progress.service.js`).

## Capacity and workload counters (release 2.1)

Seat limits and guide workload are enforced with **atomic reservations**, not count-then-write:

* `Section.studentCount`: active students per section. `reserveSeat()` does one `findOneAndUpdate` guarded by `studentCount < capacity`; `releaseSeat()` undoes it. Every student path uses it: create, import confirmation, section transfer, archive, restore and role change. `createStudentWithSeat()` releases the seat if the insert fails.
* `User.activeTeamCount` (guides): same pattern with `settings.guide.maxTeams` for team create, reassign, restore, archive and import.
* The counters are **derived data**. They have deliberately *no schema default* (a default would be written back by `save()` on old documents and corrupt the count); an absent value means "not initialised" and is initialised from real data on first use. They are recomputed at every server start, by `npm run reconcile:counters`, and by `POST /api/sections/reconcile` (HOD). `npm run check:consistency` reports any drift, and other invariants, without changing data.
* Aggregation pipelines do **not** cast string ids to ObjectIds like `find()` does; scope filters used in `aggregate()` must use real ObjectIds (this caused a bug found by tests).

## Notifications and email (release 2.1)

`notify()` always creates the in-app notification first; the email copy is sent **in the background** and its outcome is stored on the notification (`email.status`: pending/sent/failed/skipped, attempts, last error). A slow or failing SMTP server therefore never delays or fails the triggering action. `retryFailedEmails()` (`npm run retry:emails`, e.g. from cron) re-sends failed copies for the *same* records (max 3 attempts; atomic claim so two workers never double-send). An optional `dedupeKey` makes a notification idempotent per recipient. OTP delivery is different: it is the whole point of the request, so failure is reported (HTTP 503) and the OTP state is rolled back.

## Operations (release 2.1)

* **Probes:** `GET /api/health` (liveness) and `GET /api/health/ready` (database + writable upload directory); both exempt from rate limiting.
* **Rate limits:** per client IP, in memory per instance: general, sign-in, exports, uploads (`RATE_LIMIT_*`, `TRUST_PROXY`). Per-account OTP limits remain the real brute-force protection; the IP limits only stop floods, so they are generous (campuses often share one public IP).
* **Uploads:** local disk (`UPLOAD_DIR`, checked at boot; use a persistent volume). Optional antivirus hook (`UPLOAD_SCANNER_*`): infected files are quarantined under `UPLOAD_DIR/.quarantine` and rejected; `UPLOAD_SCAN_REQUIRED=true` fails closed if the scanner is down. Downloads are attachments with `nosniff`, a sandbox CSP and `no-store`.
* **Several API instances:** set `REDIS_URL` so Socket.IO events cross instances (needs Redis and the optional `@socket.io/redis-adapter` + `redis` packages). Without it realtime hints only reach users on the same instance; the UI also polls notifications every 90 s. Rate-limit counters stay per instance.
* **Requirement:** MongoDB **5.0 or newer** (dashboard aggregation uses `$lookup` with a pipeline).
* **Checks you can run:** `npm run verify:deployment` (read-only environment check, ideal for Atlas staging), `npm run check:consistency`.

## Booking concurrency (no transactions required)

1. `findOneAndUpdate({_id, status:"available"} → "pending")` – exactly one caller can claim a slot.
2. Create the request; **partial unique indexes** are the final guard: one live request per slot, and one live request per *team per review session*. A failed insert releases the slot.
3. Approve/reject/cancel are guarded by status-conditional atomic updates (double approval → 409).
4. Overrides (Coordinator in scope / HOD) need a reason and write before/after to the audit log; reassignment claims the new slot before releasing the old one.

Policy hierarchy: effective enabled = **college enabled AND section not disabled**; sections may only tighten the cut-off and choose who may request. Disabling never deletes data and never affects progress or report submission.

## Authentication

Email OTP: 6 digits from `crypto.randomInt`, stored as an HMAC hash, 5-minute expiry, 60 s resend cooldown, 5 requests/hour window, 5 verification attempts per code (reserved atomically), generic response for unknown emails, no OTP in responses or logs. JWT (default 7 d) with `tokenVersion` revocation; the browser keeps it in `sessionStorage`.

## Key decisions and assumptions

* **Feature modules + thin routes/services** instead of the old controller/route/store sprawl; same stack, ES modules, JavaScript.
* Legacy “session” meant a calendar day; v2 uses the **review session** (`reviewKey`) for “one slot per review”. Legacy rules (10 slots/day in a 2×5 grid, fixed 30-min, 1–3 h, no booking after 8 PM the previous day) were **not found in the code** (only in documentation) so nothing is hard-coded: duration range, cut-off hours and who may request are configurable.
* A slot holds **one** live request (legacy allowed several pending per slot) and a team holds one live request per review. Capacity is therefore 1.
* Students no longer self-join teams; membership is managed by Guide (own teams), Coordinator, HOD or import.
* Only the assigned Guide records review decisions; Coordinator/HOD monitor (and override bookings).
* Deadlines flag late submissions but do not block them.
* Removed as out of scope/unsafe: advanced analytics endpoints and page, broken reminder cron jobs, destructive seed scripts, the public `initialize-admin`, and public config/slot/request/team routes.
* Not built (future phase, by instruction): analytics dashboards, ML/NLP, scheduled reminders, messaging automation.
