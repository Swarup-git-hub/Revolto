# Requirements traceability

“Tests” refer to `backend/tests/*.test.js` (B) and `frontend/e2e/smoke.py` (E).
✔ implemented · ◐ partly / with a documented deviation · ✘ not implemented.

| # | Requirement (phase) | Where implemented | Verified by | |
|---|---|---|---|---|
| 2.1 | Four roles; HOD college-wide, Coordinator section-scoped, Guide assigned teams (cross-section), Student own data | `shared/scope.js`, `modules/*/routes` | B scope, auth | ✔ |
| 2.2 | Every route verifies role **and** ownership/scope | `shared/auth.js` (`protect`, `authorize`) + scope filters | B scope, auth, reviews (download authz) | ✔ |
| 2.3 | No mass assignment of role/section/team/ownership | `shared/validate.js` whitelisting; users/teams routes | B scope “mass assignment” | ✔ |
| 2.4 | Administrative overrides logged | `shared/audit.js`; override, title, settings, import, export, policy | B bookings (override), scope (title) | ✔ |
| 2.5 | Explicit Team ID & membership; central title | `models/Team.js`, `teams.routes.js`, `User.team` | B scope, reviews | ✔ |
| 2.6 | Configurable team size / section capacity / guide workload | `models/Settings.js`, `teams.service.js`, `sections/capacity.js` | B scope “limits” | ✔ |
| 2.7 | Bulk import + manual management | `modules/imports`, `users`, `teams` | B imports | ✔ |
| 2.8 | Import: template, upload, preview, row validation, duplicates, error report, explicit confirm, no overwrite | `imports.service.js`, `imports.routes.js`, `pages/admin/Imports.jsx` | B imports | ✔ |
| 2.9 | Archive/deactivate records with history | users/teams/sections archive routes; no delete routes | B scope “archived” | ✔ |
| 3.1 | Default 4-review sequence, configurable (names, order, fields, statuses, deadlines, uploads, types, size) | `reviewConfig.service.js`, `ReviewConfig`, `pages/admin/ReviewSetup.jsx` | B reviews | ◐ statuses are the fixed lifecycle; select-field options are configurable |
| 3.2 | Config protected when history exists; archive | `parseConfigInput`, `DELETE /reviews/config/:id` | B reviews | ✔ |
| 3.3 | Review 1 fields, guide confirm/request changes, title edit history with reason, optional reconfirmation | `submissions.service.js`, `teams.routes.js` (`/title`, `/title/confirm`) | B scope, reviews; E | ✔ |
| 3.4 | Review 2: team progress by leader, per-member contribution, configurable milestones, history, immediate visibility to Coordinator/HOD with separate guide status, corrections/resubmit | `submissions.service.js`, `progress.service.js`, `ReviewPanel.jsx` | B reviews; E | ✔ |
| 3.5 | Contributions not claimed as verified | status `pending_review` until `acknowledged` | B reviews; E | ✔ |
| 3.6 | Review 3 fields, versions, comparison with Review 2 without inventing completion | `/teams/:id/compare`, `Comparison` | B reviews | ✔ |
| 3.7 | Review 4: statuses, PDF default, config types/size, guide review, versions, authorised access | `shared/upload.js`, `reviews.routes.js` | B reviews | ✔ local disk storage; metadata in MongoDB |
| 4.1 | Booking independent; HOD college policy; Coordinator section policy within HOD policy | `bookings.routes.js` (`/policy`), `shared/settings.js` | B bookings; E | ✔ |
| 4.2 | Guide approves; Coordinator/HOD auditable override; guide gets no section-wide admin | `bookings.service.js`, `/override` | B bookings | ✔ |
| 4.3 | Manual + range slots, preview, validate overlap/duplicate/range/past/policy | `expandSlots`, `classifyCandidates` | B bookings; E | ✔ capacity fixed at 1 team per slot |
| 4.4 | Concurrency-safe booking | atomic claim + partial unique indexes | B bookings (parallel) + mutation check | ✔ |
| 4.5 | One approved slot per team per review session | unique index on `{team, reviewKey}` (live requests) | B bookings | ◐ also limits *pending* to one per review (legacy allowed several) |
| 4.6 | Statuses & cancellation; disabling keeps history; reviews unaffected | `BookingRequest` / `SlotTools` | B bookings; E | ✔ |
| 4.7 | Legacy rules verified before hard-coding | — | audit | ◐ not found in code → made configurable |
| 5.1 | Role dashboards, timeline, search/filters, empty/loading/error states, confirmations, responsive | `pages/*`, `components/ui` | E (13 flows, mobile) | ◐ filters exist on lists/reports; Guide dashboard has no team-level filters |
| 5.2 | Review completion vs milestone progress never merged | `ProgressSummary.jsx`, `progress.service.js` | E, B exports | ✔ |
| 5.3 | Clay style, subtle palette, status never colour-only | `index.css`, `tailwind.config.js`, `StatusBadge` | visual review | ✔ |
| 6.1 | Excel (Team-wise + Student-wise), CSV ×2, scope at export, filters, timestamp & filter context, no fabricated data | `reports.*` | B exports | ✔ |
| 6.2 | PDF export | — | — | ✘ none existed; not added |
| 7.1 | OTP: 6 digits, 5 min, bounded resend, hashed, no logging/returning codes | `auth.service.js` | B auth | ✔ |
| 7.2 | Server validation everywhere; safe errors | `Validator`, `errors.middleware.js` | B auth, all | ✔ |
| 7.3 | Upload validation (size, ext, signature, path traversal, access) | `upload.js` | B reviews | ✔ no malware scanning |
| 7.1b | OTP failure handling: no success when email was not sent; production SMTP check; no unusable code | `auth.service.js`, `config/env.js` | B otp-delivery | ✔ (real Gmail untested) |
| 7.4 | Keep OTP/booking notifications; no new scheduled reminders | `mail.js`, `notify.js` | B auth (outbox) | ◐ email logic unit-verified only; real SMTP untested |
| 8 | Test coverage list | `backend/tests`, `frontend/e2e` | `TEST_REPORT.md` | ◐ no frontend unit tests |
| 9 | README, `.env.example`, audit, traceability, architecture, test report, user guide, migration | repo root + `docs/` | — | ✔ |
| 2.6b | Atomic seat/workload enforcement (create, import, transfer, restore, reassign) | `capacity.js`, `teams.service.js`, `counters.js` | B capacity, workload (parallel tests) | ✔ |
| 2.10 | Leader can only be removed with a replacement | `teams.service.js`, `TeamDetail.jsx` | B leader; E | ✔ |
| 5.4 | Complete lists: server pagination and aggregation-based totals | `dashboard.routes.js`, `bookings.routes.js`, `Pager` | B pagination; E (People, Teams) | ◐ booking-list pagination UI not browser-tested |
| 6.3 | Exact review filter; contribution content in exports | `reports.service.js` | B reports-accuracy | ✔ |
| 7.5 | Rate limiting, readiness, upload scan hook, secure delivery, multi-instance realtime | `app.js`, `upload.js`, `socket.js` | B hardening, socket-redis | ◐ real ClamAV / managed Redis / Atlas untested |
| F | Future-phase items (analytics, ML, NLP, reminders, AI feedback) | — | — | not implemented, by instruction |
