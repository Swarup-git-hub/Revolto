# Migration and rollback (v1 → v2)

v2 changes the data model (sections, review submissions, new booking collections). **Nothing is dropped or deleted.**

## What the migration does (`backend/scripts/migrate-v1-to-v2.js`)

| Change | Detail |
|---|---|
| `users.role: "admin"` → `"hod"` | `tokenVersion` is incremented so old sessions end |
| Students without a section | Placed in one section (default `A`, set with `--section-name=X`). **Reassign afterwards in the app.** v1 had no sections, so this cannot be inferred |
| Teams | Gain `teamId` (from the old team name, de-duplicated), `section`, `leader` (first old member), `status` (`archived` if `isActive:false`), `titleStatus`; `User.team` is back-filled from the old `members` array |
| Login codes | Old plain-text `otp`, `otpExpiry`, `otpAttempts`, `lastOtpRequestTime`, `refreshToken` fields are removed (users just request a new code) |
| Legacy booking collections | `sessions`, `slots`, `requests`, `overrides`, `configs` are **left untouched and unused**. v2 uses `bookingslots` / `bookingrequests` / `settings` |

**Not migrated (incomplete):** old booking history is not converted into v2 bookings. It remains readable in the old collections. Tell users that bookings made before the upgrade must be requested again if still needed.

## Steps

1. **Back up the database** (`mongodump`) – the script also writes its own backup but a full dump is the safe baseline.
2. Dry run (default, writes nothing): `npm --prefix backend run migrate:v2`
3. Apply: `npm --prefix backend run migrate:v2 -- --apply --section-name=A` → writes `migration-backup-<time>.json` (users + teams, Extended JSON)
4. Start the API once (`npm start`): it creates the new indexes and the four default reviews, if absent.
5. Create/assign sections, coordinators and guides in the UI; reassign students that were placed in the default section.

## Rollback

`npm --prefix backend run migrate:v2 -- --rollback migration-backup-<time>.json` restores each backed-up user/team document exactly (including removed fields). Collections created by v2 (sections, submissions, …) are not deleted; drop them manually if you want a pristine v1 database, then redeploy the v1 code.

Tested on a synthetic v1-shaped database: dry-run changes nothing; apply → v2 API serves the migrated admin as HOD and lists the migrated team; rollback restores the original documents (see `docs/TEST_REPORT.md`). It has **not** been run against your production data.


---

# Upgrading 2.0 → 2.1 (no destructive changes)

Release 2.1 adds only **derived or optional fields**; nothing is deleted or rewritten.

| Addition | Where | Notes |
|---|---|---|
| `studentCount` | `sections` | recomputed from real students |
| `activeTeamCount` | guide `users` | recomputed from active teams |
| `email`, `dedupeKey` | `notifications` | optional; old notifications simply lack them |
| New unique partial index `{recipient, dedupeKey}` and an index on `email.status` | `notifications` | created when the API starts (`syncIndexes`) |

**Steps**
1. Back up the database (`mongodump`).
2. Check the server is **MongoDB ≥ 5.0**.
3. Deploy and start the API. At start it reconciles the counters and builds the new indexes.
4. Set the production variables that are now enforced: `GMAIL_USER`, `GMAIL_APP_PASSWORD` (the API refuses to start in production without them); review `UPLOAD_DIR`, `TRUST_PROXY` and the `RATE_LIMIT_*` values (see `backend/.env.example`).
5. Run `npm --prefix backend run verify:deployment` and `npm --prefix backend run check:consistency`.
6. Optional: schedule `npm --prefix backend run retry:emails` (e.g. every 10 minutes) to re-send failed notification emails.

**Rollback:** redeploy the 2.0 code; it ignores the new fields. To remove them as well:
```js
db.sections.updateMany({}, { $unset: { studentCount: "" } })
db.users.updateMany({ role: "guide" }, { $unset: { activeTeamCount: "" } })
db.notifications.updateMany({}, { $unset: { email: "", dedupeKey: "" } })
db.notifications.dropIndex("recipient_1_dedupeKey_1")   // optional
```
Note: 2.0 does not enforce the new capacity/workload reservations, so counters will drift while 2.0 runs; the next 2.1 start reconciles them.
