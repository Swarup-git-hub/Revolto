#!/bin/sh
# Runs the browser smoke test against a throw-away database. Requirements: a reachable MongoDB, Node, and
# `pip install playwright && playwright install chromium`. Usage (from the repository root):
#   MONGO_BASE=mongodb://127.0.0.1:27017 sh frontend/e2e/run.sh
# It NEVER touches your real database: it uses the database name "reviewslot_e2e" on MONGO_BASE and drops it first.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MONGO_BASE="${MONGO_BASE:-mongodb://127.0.0.1:27017}"
export NODE_ENV=development PORT=5100 JWT_SECRET=e2e-secret-e2e-secret-e2e-secret-1234 DEV_FIXED_OTP=123456 \
  GMAIL_USER= GMAIL_APP_PASSWORD= UPLOAD_DIR=./uploads-e2e OTP_RESEND_COOLDOWN_SECONDS=0 OTP_MAX_REQUESTS_PER_HOUR=100 \
  CORS_ORIGIN=http://localhost:4173 MONGO_URI="$MONGO_BASE/reviewslot_e2e?directConnection=true"

cd "$ROOT/backend"
node -e 'import("mongoose").then(async m=>{await m.default.connect(process.env.MONGO_URI);await m.default.connection.dropDatabase();process.exit(0)})'
node scripts/seed-demo.js
# extra volume so pagination is exercised (60 students + 40 teams)
node --input-type=module -e '
import m from "mongoose";
await m.connect(process.env.MONGO_URI); const d = m.connection.db; const now = new Date();
const A = (await d.collection("sections").findOne({ name: "A" }))._id;
const g = (await d.collection("users").findOne({ email: "guide1@example.edu" }))._id;
await d.collection("users").insertMany(Array.from({ length: 60 }, (_, i) => ({ name: "Bulk Student " + String(i).padStart(2, "0"), email: "bulk" + i + "@example.edu", role: "student", rollNumber: "BK" + String(i).padStart(2, "0"), section: A, team: null, isActive: true, tokenVersion: 0, sections: [], createdAt: now, updatedAt: now })));
await d.collection("teams").insertMany(Array.from({ length: 40 }, (_, i) => ({ teamId: "PG-T" + String(i).padStart(2, "0"), section: A, guide: g, leader: null, projectTitle: "Paged project " + i, titleStatus: "not_submitted", titleHistory: [], status: "active", createdAt: now, updatedAt: now })));
process.exit(0)'

node src/server.js > /tmp/e2e-api.log 2>&1 &
API=$!
cd "$ROOT/frontend"
npm run build >/dev/null
VITE_DEV_API=http://localhost:5100 npx vite preview --port 4173 --strictPort > /tmp/e2e-web.log 2>&1 &
WEB=$!
trap 'kill $API $WEB 2>/dev/null' EXIT
sleep 6
CODE=0
BASE=http://localhost:4173 SHOTS="${SHOTS:-./shots}" python3 e2e/smoke.py || CODE=$?
echo "--- database consistency after the browser flows:"
(cd ../backend && node scripts/check-consistency.js) || CODE=1
exit $CODE
