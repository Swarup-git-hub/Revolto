// Portable test runner: executes every *.test.js file serially with Node's built-in test runner.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort().map((f) => path.join(dir, f));
const res = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...process.argv.slice(2), ...files], { stdio: "inherit" });
process.exit(res.status ?? 1);
