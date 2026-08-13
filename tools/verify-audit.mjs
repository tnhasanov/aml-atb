#!/usr/bin/env node
/**
 * Verify the audit trail's hash chain across every day file, in order.
 *
 * This is the check a supervisor or internal auditor would run. It walks the
 * files chronologically because the chain is seeded from the previous day's
 * final record, so the whole trail is one continuous chain rather than one per
 * file.
 *
 * Usage:  node tools/verify-audit.mjs [audit-dir]
 * Exits non-zero if the chain is broken.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const dir = process.argv[2] ?? process.env.AUDIT_DIR ?? "./audit";

if (!existsSync(dir)) {
  console.error(`audit directory not found: ${dir}`);
  process.exit(2);
}

const files = readdirSync(dir)
  .filter((f) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
  .sort();

if (!files.length) {
  console.error(`no audit files in ${dir}`);
  process.exit(2);
}

const sha256 = (line) => createHash("sha256").update(line).digest("hex");

let expected = "genesis";
let records = 0;
let restarts = 0;
const breaks = [];

for (const file of files) {
  const lines = readFileSync(join(dir, file), "utf8").split("\n").filter((l) => l.trim());

  for (const [i, line] of lines.entries()) {
    records++;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      breaks.push({ file, line: i + 1, reason: "not valid JSON" });
      break;
    }
    if (record.prev !== expected) {
      breaks.push({
        file,
        line: i + 1,
        id: record.id,
        ts: record.ts,
        reason: `prev=${String(record.prev).slice(0, 16)}… expected=${expected.slice(0, 16)}…`,
      });
    }
    if (record.type === "service_started") restarts++;
    expected = sha256(line);
  }
}

console.log(`audit directory : ${dir}`);
console.log(`files           : ${files.length} (${files[0]} … ${files.at(-1)})`);
console.log(`records         : ${records}`);
console.log(`service starts  : ${restarts}`);

if (breaks.length) {
  console.error(`\nCHAIN BROKEN at ${breaks.length} point(s):`);
  for (const b of breaks.slice(0, 20)) {
    console.error(`  ${b.file}:${b.line}  ${b.reason}${b.ts ? `  (${b.ts})` : ""}`);
  }
  if (breaks.length > 20) console.error(`  … and ${breaks.length - 20} more`);
  console.error(
    "\nA break means a record was edited, deleted or reordered after it was written.",
  );
  process.exit(1);
}

console.log("\nchain intact — every record links to its predecessor");
