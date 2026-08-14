import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFileSync as run } from "node:child_process";
import { rmSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Regression tests for the go-live blockers.
 *
 * Each of these reproduces a defect that shipped in 0.1.0 and would have
 * misled a compliance officer or a supervisor in production.
 */

const DIR = "./audit/hardening-test";

before(() => {
  rmSync(DIR, { recursive: true, force: true });
  process.env.AUDIT_DIR = DIR;
  process.env.AUTH_MODE = "none";
});

after(() => {
  rmSync(DIR, { recursive: true, force: true });
});

function chainIsIntact(dir: string): { ok: boolean; records: number; broken: number } {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  let expected = "genesis";
  let records = 0;
  let broken = 0;
  for (const file of files) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n").filter((l) => l.trim())) {
      records++;
      if (JSON.parse(line).prev !== expected) broken++;
      expected = createHash("sha256").update(line).digest("hex");
    }
  }
  return { ok: broken === 0, records, broken };
}

// ---------------------------------------------------------------- audit chain

test("the hash chain survives a process restart", () => {
  // 0.1.0 reset the in-memory hash to "genesis" on every start, writing a break
  // into the middle of the day's file. A routine restart was indistinguishable
  // from tampering, which defeated the whole purpose of the chain.
  const script = (msg: string) =>
    `process.env.AUDIT_DIR=${JSON.stringify(DIR)};` +
    `import("./dist/src/audit.js").then(m=>{m.initAudit("t");` +
    `m.audit({type:"user_message",session_id:"s",message:${JSON.stringify(msg)}},{user:"u",ip:"1"})});`;

  run("node", ["-e", script("before restart")], { stdio: "pipe" });
  run("node", ["-e", script("after restart")], { stdio: "pipe" });

  const result = chainIsIntact(DIR);
  assert.ok(result.records >= 4, `expected records from both runs, got ${result.records}`);
  assert.equal(result.broken, 0, "restart must not break the chain");
});

test("restarts are recorded as events, so they are explainable", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".jsonl"));
  const records = files.flatMap((f) =>
    readFileSync(join(DIR, f), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l)),
  );
  const starts = records.filter((r) => r.type === "service_started");
  assert.ok(starts.length >= 2, "each start should leave a service_started record");
  assert.ok(starts[0].pid, "service_started should carry the pid");
});

test("the verifier CLI passes on an intact trail and fails on a tampered one", () => {
  const out = run("node", ["tools/verify-audit.mjs", DIR], { encoding: "utf8" });
  assert.match(out, /chain intact/);

  // Rewrite a question after the fact, exactly what the chain exists to catch.
  const file = join(DIR, readdirSync(DIR).filter((f) => f.endsWith(".jsonl")).sort()[0]!);
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  lines[1] = lines[1]!.replace("before restart", "AFTER THE FACT");
  const tamperedDir = `${DIR}-tampered`;
  rmSync(tamperedDir, { recursive: true, force: true });
  mkdirSync(tamperedDir, { recursive: true });
  // writeFileSync imported at top
  writeFileSync(join(tamperedDir, "audit-2020-01-01.jsonl"), lines.join("\n") + "\n");

  assert.throws(
    () => execFileSync("node", ["tools/verify-audit.mjs", tamperedDir], { stdio: "pipe" }),
    /Command failed|status 1/,
    "verifier must exit non-zero on a tampered trail",
  );
  rmSync(tamperedDir, { recursive: true, force: true });
});

test("audit files are not world-readable", () => {
  // They contain pasted customer names, FINs and PEP status.
  const file = join(DIR, readdirSync(DIR).filter((f) => f.endsWith(".jsonl"))[0]!);
  const mode = statSync(file).mode & 0o777;
  assert.equal(mode & 0o077, 0, `audit file mode is ${mode.toString(8)}, expected owner-only`);
  const dirMode = statSync(DIR).mode & 0o777;
  assert.equal(dirMode & 0o077, 0, `audit dir mode is ${dirMode.toString(8)}`);
});

test("an API key is redacted before it can reach the audit file", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-api03-SECRETVALUE123456";
  const { audit } = await import("../src/audit.js");
  audit(
    {
      type: "error",
      session_id: "s",
      message: "Headers.append: sk-ant-api03-SECRETVALUE123456 is invalid",
    },
    { user: "u", ip: "1" },
  );
  const contents = readdirSync(DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => readFileSync(join(DIR, f), "utf8"))
    .join("");
  assert.ok(!contents.includes("SECRETVALUE123456"), "the key must never be written to disk");
  assert.ok(contents.includes("[REDACTED]"));
  delete process.env.ANTHROPIC_API_KEY;
});

// ---------------------------------------------------------------- audit off

test("AUDIT_MODE=off writes nothing at all, and does not create a directory", () => {
  // The pilot deployment on Render's free plan runs this way. "Off" has to mean
  // off: a half-written trail on an ephemeral disk is worse than none, because
  // it looks like a record until someone tries to verify it.
  const dir = "./audit/off-test";
  rmSync(dir, { recursive: true, force: true });

  const script =
    `import("./dist/src/audit.js").then(m=>{m.initAudit("t");` +
    `m.audit({type:"user_message",session_id:"s",message:"müştəri adı"},{user:"u",ip:"1"});` +
    `console.log("failure:"+m.auditFailure())});`;

  const out = run("node", ["-e", script], {
    env: { ...process.env, AUDIT_DIR: dir, AUDIT_MODE: "off", AUTH_MODE: "none" },
    encoding: "utf8",
    stdio: "pipe",
  });

  assert.match(out, /failure:null/, "an absent trail is not a failure state in this mode");
  assert.equal(existsSync(dir), false, `AUDIT_MODE=off created ${dir}`);
});

test("AUDIT_MODE=off still starts where a durable trail could not", () => {
  // No disk to write to is the whole reason this mode exists, so the
  // serverless guard must not fire and initAudit must not throw.
  const out = run(
    "node",
    ["-e", 'import("./dist/src/config.js").then(m=>console.log("mode:"+m.config.auditMode))'],
    {
      env: { ...process.env, AUDIT_MODE: "off", AUTH_MODE: "none", VERCEL: "1" },
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  assert.match(out, /mode:off/);
});

test("an unrecognised AUDIT_MODE is refused, not treated as off", () => {
  // A typo like AUDIT_MODE=false must not silently disable the trail.
  assert.throws(
    () =>
      execFileSync("node", ["-e", 'import("./dist/src/config.js")'], {
        env: { ...process.env, AUDIT_MODE: "false", AUTH_MODE: "none" },
        stdio: "pipe",
      }),
    /Command failed|status 1/,
  );
});

// ---------------------------------------------------------------- speed

test("AML_SPEED=fast is refused on a model that does not offer it", () => {
  // Fast mode exists only on the Opus tier. Accepting it silently on Sonnet
  // would bill nothing extra but also do nothing, and the first anyone would
  // know is that answers never got faster.
  assert.throws(
    () =>
      execFileSync("node", ["-e", 'import("./dist/src/config.js")'], {
        env: { ...process.env, AML_SPEED: "fast", AML_MODEL: "claude-sonnet-5", AUTH_MODE: "none" },
        stdio: "pipe",
      }),
    /Command failed|status 1/,
  );
});

test("AML_SPEED=fast is accepted on a fast-capable model", () => {
  const out = run(
    "node",
    ["-e", 'import("./dist/src/config.js").then(m=>console.log(m.config.speed+" "+m.config.model))'],
    {
      env: { ...process.env, AML_SPEED: "fast", AML_MODEL: "claude-opus-5", AUTH_MODE: "none" },
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  assert.match(out, /fast claude-opus-5/);
});

test("an unrecognised AML_SPEED is refused rather than ignored", () => {
  assert.throws(
    () =>
      execFileSync("node", ["-e", 'import("./dist/src/config.js")'], {
        env: { ...process.env, AML_SPEED: "quick", AUTH_MODE: "none" },
        stdio: "pipe",
      }),
    /Command failed|status 1/,
  );
});

// ---------------------------------------------------------------- history

test("trimming never leaves an assistant message first, or an orphaned tool_result", async () => {
  const { trimHistory } = await import("../src/server.js");

  // Vary the tool-iteration count per turn: the 0.1.0 bug only bit at certain
  // alignments, which is why it survived the original test suite.
  for (let toolRounds = 0; toolRounds <= 3; toolRounds++) {
    const history: Anthropic.MessageParam[] = [];
    for (let turn = 0; turn < 30; turn++) {
      history.push({ role: "user", content: `question ${turn}` });
      for (let r = 0; r < (turn % (toolRounds + 1)); r++) {
        history.push({ role: "assistant", content: [{ type: "tool_use", id: `t${turn}_${r}`, name: "x", input: {} }] as any });
        history.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${turn}_${r}`, content: "{}" }] as any });
      }
      history.push({ role: "assistant", content: [{ type: "text", text: `answer ${turn}` }] as any });

      trimHistory(history);

      assert.equal(history[0]!.role, "user", `toolRounds=${toolRounds} turn=${turn}: first message must be user`);
      assert.ok(
        !Array.isArray(history[0]!.content) ||
          !(history[0]!.content as any[]).some((b) => b?.type === "tool_result"),
        "first message must not be a tool_result carrier",
      );

      const useIds = new Set(
        history.flatMap((m) =>
          Array.isArray(m.content)
            ? (m.content as any[]).filter((b) => b?.type === "tool_use").map((b) => b.id)
            : [],
        ),
      );
      const orphans = history.flatMap((m) =>
        Array.isArray(m.content)
          ? (m.content as any[]).filter((b) => b?.type === "tool_result" && !useIds.has(b.tool_use_id))
          : [],
      );
      assert.equal(orphans.length, 0, `toolRounds=${toolRounds} turn=${turn}: orphaned tool_result`);
    }
  }
});

// ---------------------------------------------------------------- errors

test("upstream error detail never reaches the user", async () => {
  const { userFacingError } = await import("../src/server.js");

  const leaky =
    'Headers.append: "sk-ant-api03-REALKEYMATERIAL" is an invalid header value.';
  const shown = userFacingError(leaky);
  assert.ok(!shown.includes("sk-ant"), "must not echo key material");
  assert.ok(!shown.includes("REALKEYMATERIAL"));
  assert.match(shown, /İT dəstəyi/, "should tell the officer who to contact");

  assert.match(userFacingError("429 rate_limit_error"), /sorğu həddi/i);
  assert.match(userFacingError("ETIMEDOUT"), /vaxtında cavab vermədi/);
});
