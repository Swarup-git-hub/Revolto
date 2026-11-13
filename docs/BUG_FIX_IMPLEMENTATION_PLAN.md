# Bug-fix implementation plan (maintenance release 2.1)

Scope: fix **verified** defects in the delivered v2 without rebuilding, redesigning or adding product features.
Baseline (before any change, this environment): **backend 47/47 tests pass; frontend production build succeeds.**
Every finding below was re-verified against the *current source* (not only the earlier audit documents).

## Premises in the brief that do not match this codebase

| Brief says | Evidence | Action |
|---|---|---|
| "Do not change the Deep Violet visual design" | `grep -ri "violet\|purple"` over `frontend/src` + Tailwind config → **0 hits**. The delivered design is the slate/sage clay palette (`tailwind.config.js`). | No design change made. Not applicable. |
| "HOD favorites" | `grep -ri favou?rite` over backend, frontend, docs → **0 hits**. Feature does not exist. | Documented as absent; nothing changed. |

## Findings

Status legend: ☐ planned · ☑ fixed & verified (details, tests and remaining limitations in `BUG_FIX_CHANGELOG.md`).

### F1 — OTP request reports success when the email was not sent (Batch 1)
* **Evidence:** `shared/mail.js:21-23` returns `false` when SMTP is unconfigured; `auth.service.js:44` awaits `sendOtpEmail` and ignores the value, so `requestOtp` answers "sent".
* **Files:** `shared/mail.js`, `modules/auth/auth.service.js`
* **Root cause:** failure is signalled by a return value nobody checks.
* **Fix:** delivery failure throws; `requestOtp` surfaces HTTP 503; unconfigured mail is detected *before* the user lookup so the answer is identical for known and unknown addresses (no enumeration). A fixed dev OTP (`DEV_FIXED_OTP`) needs no mail and keeps working outside production.
* **Regression risk:** local developers without SMTP now get a clear 503 instead of a silent "sent" (unless `DEV_FIXED_OTP` is set). Low.
* **Tests:** unconfigured mail (known + unknown email), dev fixed OTP without mail, successful delivery, SMTP rejection, no OTP in responses/logs, existing OTP security tests.
* **Status:** ☑ verified by `otp-delivery.test.js`

### F2 — No production SMTP configuration validation (Batch 1)
* **Evidence:** `config/env.js` `assertEnv` checks only `JWT_SECRET` and `DEV_FIXED_OTP`.
* **Fix:** in production, require `GMAIL_USER` and `GMAIL_APP_PASSWORD` at boot (fail fast). `assertEnv` takes the config as a parameter so it is unit-testable.
* **Risk:** a production deployment that previously booted without mail now refuses to start (intended). **Status:** ☑ verified by `otp-delivery.test.js`

### F3 — Failed delivery leaves an unusable OTP and burns the user's limits (Batch 1)
* **Evidence:** `auth.service.js:30-47`: the hash, `lastSentAt` and `requestsInWindow+1` are stored **before** sending; in production the 503 is thrown after that. The user has no code but is on cooldown and one request closer to the hourly cap.
* **Fix:** snapshot the previous OTP state; on failure restore it exactly (or unset), so a failed delivery consumes no budget and never leaves a code nobody received. Previously issued, still-valid code remains valid.
* **Risk:** none for security: nothing was delivered, so nothing is granted. **Status:** ☑ verified by `otp-delivery.test.js`

### F4 — Notification email results ignored; no tracking; slow SMTP blocks requests (Batch 2)
* **Evidence:** `shared/notify.js` awaits `Promise.allSettled(...)` and discards the results; failures are invisible; the HTTP handler waits for SMTP.
* **Fix:** per-notification `email` delivery record (`status`, `attempts`, `lastError`); failures logged safely (id + error text, no address/body); emails sent in the background (booking approval never waits on SMTP); `retryFailedEmails()` re-sends **existing** records (never creates new notifications); optional `dedupeKey` (unique per recipient) prevents duplicate notifications on retried operations.
* **Migration:** additive fields only. **Status:** ☑ verified by `notifications.test.js`

### F5 — Section capacity check/create race (Batch 3)
* **Evidence:** `sections/capacity.js` counts then the caller creates (`users.routes.js:100`) → two concurrent requests can both pass at `cap-1`.
* **Fix:** atomic seat reservation via a persistent counter `Section.studentCount` (`findOneAndUpdate` with `studentCount < cap`), released on any failure; reconciliation job/endpoint/boot step recomputes counters from real data.
* **Migration:** additive field + reconcile (idempotent; reversible by `$unset`). **Status:** ☑ verified by `capacity.test.js`

### F6 — Import confirmation does not enforce capacity (Batch 3)
* **Evidence:** `imports.service.js:184` `User.create(...)` with no capacity check; only the *preview* looked at capacity.
* **Fix:** `applyRows` reserves a seat per row (re-checked at confirm time); a row that no longer fits is reported as failed, never silently over-filled. **Status:** ☑ verified by `capacity.test.js`

### F7 — Transfer/restore use the same racy check (Batch 3)
* **Evidence:** `users.routes.js:163` (section change) and `:193` (restore) call the count-based check; transfer never releases the old section.
* **Fix:** all student paths (create, import, transfer, archive, restore, role change) go through reserve/release helpers. **Status:** ☑ verified by `capacity.test.js`

### F8 — Guide workload race (Batch 4)
* **Evidence:** `teams.service.js:9-18` counts active teams then callers create/reassign/restore (`teams.routes.js:58,93,178`; `imports.service.js:188`).
* **Fix:** atomic reservation on `User.activeTeamCount` (guides) with the same reconcile strategy; reserve on create/restore/reassign/import, release on archive/reassign-away/failed creation. Configured `maxTeams` is never changed and no team is silently reassigned. **Status:** ☑ verified by `workload.test.js`

### F9 — Removing the team leader leaves the team leaderless (Batch 5)
* **Evidence:** `teams.service.js removeMember` sets `leader: null`; a leaderless team cannot submit any review.
* **Fix:** removal of the leader requires `replacementLeaderId` (active member of the same team, not the leader); sole-member leader removal is refused; the leader switches **before** membership is removed; audit + notifications. Archiving a student who is an active team's leader is refused for the same reason (same defect class).
* **Frontend:** remove dialog asks for the replacement. **Status:** ☑ verified by `leader.test.js + browser flow`

### F10 — Review filter silently falls back to the team's current review (Batch 6A)
* **Evidence:** `reports.service.js:24` `find(review) || currentReview…`.
* **Fix:** exact match; unknown review key → 400; teams for which the review is not configured are excluded and the exclusion count is stated in the export context. **Status:** ☑ verified by `reports-accuracy.test.js`

### F11 — Contribution export has counts and status but no content (Batch 6B)
* **Evidence:** `reports.service.js:50-51` exports only version count and status.
* **Fix:** add review, summary and task columns (status/version stay separate; self-reports are never labelled verified). **Status:** ☑ verified by `reports-accuracy.test.js`

### F12 — Silent truncation (Batch 7)
* **Evidence:** dashboard `limit(2000)` teams (`dashboard.routes.js:25`) and per-team progress for all of them; People/Teams UI request `limit: 200` and show `total` while rendering ≤200 rows; booking slots `limit(500)`, requests `limit(300)`, and requests first load *every* team id in scope.
* **Fix:** dashboard summaries computed with aggregation (no row cap, no per-team history load); server pagination with `total/page/limit` on slots and requests; scope applied directly in the query; pagination controls on People, Teams and Bookings, preserving filters. **Status:** ☑ verified by `pagination.test.js + browser (People, Teams)`

### F13 — Production hardening (Batch 8) — evaluated item by item
| Item | Evidence | Decision |
|---|---|---|
| Rate limiting | none (`app.js`) | implement (`express-rate-limit`, per-IP; global + stricter auth limits) — per-instance memory store unless a shared store is added |
| SMTP production check | see F2 | implement |
| Persistent upload storage | `UPLOAD_DIR` local disk, not verified at boot | implement boot-time writability check + production guidance; **no cloud storage driver** (operational cost) |
| Secure file delivery | attachment + `no-store` + helmet `nosniff` | add explicit `nosniff` + test |
| Upload malware scan | none | implement optional pluggable scanner hook (external command, fail-closed option, quarantine). Real ClamAV not available here |
| Dependency advisories | see TEST_REPORT | re-run and document |
| Multi-instance Socket.IO | single in-process emitter | evaluate; optional adapter only if it can be verified; otherwise document degradation (clients poll every 90 s) |
| MongoDB Atlas verification | no Atlas access | **blocked externally**: provide a read-only verification script + checklist |

* **Status:** ☑ rate limiting, SMTP check, upload-directory check, download headers, scanner hook, Redis adapter, advisory review and the verification script are implemented and tested (`hardening.test.js`, `socket-redis.test.js`, `consistency.test.js`). **Blocked externally:** Atlas run, real SMTP, real ClamAV, managed Redis.

### F14 — Destructive buttons rendered unstyled (found during Batch 5 browser verification)
* **Evidence:** built CSS had 0 occurrences of `.btn-danger` (primary/soft/ghost present); `Button` composes ``btn-${variant}`` dynamically so Tailwind's scanner never saw the name; screenshot of the remove dialog showed the confirm button as plain grey text.
* **Files:** `frontend/tailwind.config.js` · **Fix:** safelist the four button classes. **Regression test:** CSS-content assertion in the browser smoke run. No visual redesign: it restores the intended style.
* **Status:** ☑ verified by `browser style assertion`

## Not defects / deferred (documented, nothing changed)

| Item | Why it is not treated as a bug |
|---|---|
| PDF export of reports | never existed; feature, not defect |
| Advanced analytics, scheduled reminders, AI feedback | deferred by product decision |
| One pending request per team per review (legacy allowed several) | product decision recorded in `ARCHITECTURE.md` |
| Who may edit a title (Guide/Coordinator/HOD can, students cannot) | permission policy; changing it needs approval |
| Counters can drift if someone writes users/teams directly in the database | inherent to counters; mitigated by reconcile (boot, script, HOD endpoint) |

## Added during implementation (findings that emerged while verifying)
| Finding | Resolution |
|---|---|
| Counter fields with a schema default would be re-written by `save()` on legacy documents and corrupt counts (found by `capacity.test.js`) | no default; absent = "not initialised", initialised lazily from real data |
| Dashboard rewrite counted 0 teams for Coordinators (aggregation does not cast string ids; regression from this release's own change) | scope expressed with ObjectIds; explicit coordinator assertions added; caught before delivery |
| Empty filtered exports had no CSV header | fixed column lists |
| `verify-deployment` was not read-only (Mongoose `autoIndex`/`autoCreate` ran on connect) | read-only connection mode; test proves nothing is created |
| Per-IP rate limits would lock out a whole campus behind one NAT address at tight defaults | generous defaults + documented |
| Guide reassignment leaves requests with the previous guide | **not changed**; listed as unresolved (product decision) |
| Slot-creation lost-race branch relied on an unverified Mongoose error shape | verified; **not a defect**; locked in by `slot-race.test.js` |
