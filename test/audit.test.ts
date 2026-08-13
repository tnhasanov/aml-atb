import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const AUDIT_DIR = "./audit/unit-test";

before(() => {
  rmSync(AUDIT_DIR, { recursive: true, force: true });
  process.env.AUDIT_DIR = AUDIT_DIR;
});

after(() => {
  rmSync(AUDIT_DIR, { recursive: true, force: true });
});

function readRecords(): { raw: string; parsed: any }[] {
  const file = join(AUDIT_DIR, readdirSync(AUDIT_DIR)[0]!);
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((raw) => ({ raw, parsed: JSON.parse(raw) }));
}

/** The check a supervisor (or an internal auditor) would run over the log. */
function chainIsIntact(records: { raw: string; parsed: any }[]): boolean {
  let prev = "genesis";
  for (const { raw, parsed } of records) {
    if (parsed.prev !== prev) return false;
    prev = createHash("sha256").update(raw).digest("hex");
  }
  return true;
}

test("every interaction is recorded with a hash chain that verifies", async () => {
  const { audit } = await import("../src/audit.js");

  audit({ type: "session_started", session_id: "s1" });
  audit({ type: "user_message", session_id: "s1", message: "Can I apply simplified CDD?" });
  audit({ type: "tool_call", session_id: "s1", tool: "determine_cdd_level", input: { risk_group: "low" } });
  audit({ type: "tool_result", session_id: "s1", tool: "determine_cdd_level", ok: true, summary: {} });
  audit({ type: "assistant_message", session_id: "s1", message: "Yes - clause 4.1.1.", citations: ["4.1.1"] });

  const records = readRecords();
  assert.equal(records.length, 5);
  assert.ok(chainIsIntact(records), "hash chain should verify on an untouched log");

  // Each record carries what an audit needs: who, when, and what.
  for (const { parsed } of records) {
    assert.ok(parsed.id, "record needs an id");
    assert.ok(parsed.ts, "record needs a timestamp");
    assert.ok(parsed.prev, "record needs the previous hash");
    assert.equal(parsed.session_id, "s1");
  }
});

test("editing a past record breaks the chain, which is the point", () => {
  const records = readRecords();

  // Simulate someone quietly rewriting the question that was asked.
  const tampered = records.map((r, i) =>
    i === 1
      ? { raw: r.raw.replace("simplified CDD", "enhanced CDD"), parsed: r.parsed }
      : r,
  );

  assert.equal(chainIsIntact(tampered), false, "a modified record must fail verification");
});

test("deleting a record breaks the chain", () => {
  const records = readRecords();
  const withHole = [...records.slice(0, 2), ...records.slice(3)];
  assert.equal(chainIsIntact(withHole), false, "a removed record must fail verification");
});

test("citation extraction picks up clause references in both languages", async () => {
  const { extractCitations } = await import("../src/audit.js");

  assert.deepEqual(
    extractCitations("Enhanced measures apply under clause 5.2 and review under clause 8.1.4."),
    ["5.2", "8.1.4"],
  );
  assert.deepEqual(extractCitations("Bu, Qaydaların 3.9.1-ci bəndi ilə müəyyən edilir.").length, 0);
  assert.deepEqual(extractCitations("bənd 3.9.1 tətbiq olunur"), ["3.9.1"]);
  assert.deepEqual(extractCitations("no references here"), []);
});
