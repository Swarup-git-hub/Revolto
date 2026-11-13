// Stand-in for an antivirus CLI. usage: node fake-scanner.mjs <file> <mode>
// It also proves that the "{file}" placeholder was replaced with a real, existing path.
import fs from "node:fs";
const [file, mode = "clean"] = process.argv.slice(2);
if (!file || !fs.existsSync(file)) process.exit(3); // placeholder not substituted / file missing → scanner error
if (mode === "infected") process.exit(1);
if (mode === "error") process.exit(2);
if (mode === "hang") setTimeout(() => process.exit(0), 20000);
else process.exit(0);
