import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { hashPassword, verifyPassword, parseAuthUsers } from "../src/password.js";

/**
 * AUTH_MODE=basic is what stands between a public URL and an assistant that
 * answers questions about customers. These tests cover the ways it could be
 * wrong in a manner nobody would notice from the outside.
 */

// ---------------------------------------------------------------- hashing

test("a password verifies against its own hash and nothing else", () => {
  const hash = hashPassword("düzgün-şifrə-2026");
  assert.ok(verifyPassword("düzgün-şifrə-2026", hash));
  assert.ok(!verifyPassword("duzgun-sifre-2026", hash), "Azerbaijani diacritics must matter");
  assert.ok(!verifyPassword("", hash));
  assert.ok(!verifyPassword("düzgün-şifrə-2026 ", hash), "no trimming of the presented password");
});

test("the same password hashes differently every time", () => {
  // A deterministic hash would let anyone with the env var see which two
  // colleagues chose the same password.
  const a = hashPassword("eyni-sifre-12345");
  const b = hashPassword("eyni-sifre-12345");
  assert.notEqual(a, b);
  assert.ok(verifyPassword("eyni-sifre-12345", a) && verifyPassword("eyni-sifre-12345", b));
});

test("a malformed or hostile hash is rejected rather than throwing", () => {
  // These reach scryptSync straight from an environment variable; an exception
  // here would be a 500 on the sign-in page instead of a refusal.
  for (const bad of [
    "",
    "plaintext",
    "scrypt$16384$8$1$onlyfourfields",
    "scrypt$0$8$1$c2FsdA==$aGFzaA==", // N below the floor
    "scrypt$99999999$8$1$c2FsdA==$aGFzaA==", // N above the ceiling: would exhaust memory
    "scrypt$16384$8$1$$aGFzaA==", // empty salt
    "scrypt$16384$8$1$c2FsdA==$", // empty expected hash
    "bcrypt$16384$8$1$c2FsdA==$aGFzaA==",
    "scrypt$abc$8$1$c2FsdA==$aGFzaA==",
  ]) {
    assert.doesNotThrow(() => verifyPassword("anything", bad), `threw on ${JSON.stringify(bad)}`);
    assert.equal(verifyPassword("anything", bad), false, `accepted ${JSON.stringify(bad)}`);
  }
});

// ---------------------------------------------------------------- AUTH_USERS

test("AUTH_USERS parses several accounts and keeps colons in hashes intact", () => {
  const spec = `aygun:${hashPassword("password-one-12")},rashad:${hashPassword("password-two-12")}`;
  const accounts = parseAuthUsers(spec);
  assert.deepEqual(accounts.map((a) => a.user), ["aygun", "rashad"]);
  assert.ok(verifyPassword("password-one-12", accounts[0]!.hash));
  assert.ok(verifyPassword("password-two-12", accounts[1]!.hash));
});

test("AUTH_USERS refuses a plaintext password rather than storing it", () => {
  // The whole point is that the deployment platform never holds a password.
  assert.throws(() => parseAuthUsers("aygun:hunter2"), /not a scrypt hash/);
});

test("AUTH_USERS rejects a username that could not appear in an audit record", () => {
  const h = hashPassword("password-one-12");
  assert.throws(() => parseAuthUsers(`ay gun:${h}`), /audit record/);
  assert.throws(() => parseAuthUsers(`ay\ngun:${h}`), /audit record/);
  assert.throws(() => parseAuthUsers(`:${h}`), /username:hash/);
});

test("a duplicated username is an error, not a silent last-one-wins", () => {
  // Two entries for one name means two people share an identity in the audit
  // trail, and only one of them can ever sign in.
  const spec = `aygun:${hashPassword("password-one-12")},aygun:${hashPassword("password-two-12")}`;
  assert.throws(() => parseAuthUsers(spec), /twice/);
});

// ---------------------------------------------------------------- config guards

/** Load src/config.js in a clean process with the given environment. */
function loadConfig(env: Record<string, string>): { ok: boolean; output: string } {
  try {
    const out = execFileSync(
      process.execPath,
      ["-e", 'import("./dist/src/config.js").then(m=>console.log(m.config.authMode+" "+m.config.authAccounts.length))'],
      { env: { ...process.env, ...env }, encoding: "utf8", stdio: "pipe" },
    );
    return { ok: true, output: out };
  } catch (err: any) {
    return { ok: false, output: String(err.stderr ?? err.message) };
  }
}

test("AUTH_MODE=basic without AUTH_USERS refuses to start", () => {
  const r = loadConfig({ AUTH_MODE: "basic", AUTH_USERS: "", BIND_HOST: "0.0.0.0" });
  assert.equal(r.ok, false);
  assert.match(r.output, /AUTH_USERS/);
  assert.match(r.output, /hash-password/, "the error should say how to fix it");
});

test("AUTH_MODE=basic with accounts starts on a public bind", () => {
  const r = loadConfig({
    AUTH_MODE: "basic",
    AUTH_USERS: `aygun:${hashPassword("password-one-12")}`,
    BIND_HOST: "0.0.0.0",
  });
  assert.ok(r.ok, r.output);
  assert.match(r.output, /basic 1/);
});

test("a serverless platform is refused, because the audit trail would evaporate", () => {
  // Deploying to Vercel would otherwise look like it worked, right up until
  // someone asked for the records.
  const r = loadConfig({
    AUTH_MODE: "basic",
    AUTH_USERS: `aygun:${hashPassword("password-one-12")}`,
    BIND_HOST: "0.0.0.0",
    VERCEL: "1",
  });
  assert.equal(r.ok, false);
  assert.match(r.output, /Vercel/);
  assert.match(r.output, /HOSTING\.md/, "the error should point at the alternative");
});

test("the serverless refusal can be overridden deliberately, for a demo", () => {
  const r = loadConfig({
    AUTH_MODE: "basic",
    AUTH_USERS: `aygun:${hashPassword("password-one-12")}`,
    BIND_HOST: "0.0.0.0",
    VERCEL: "1",
    AML_ALLOW_EPHEMERAL_AUDIT: "1",
  });
  assert.ok(r.ok, r.output);
});

test("AUTH_MODE=none is still refused on a public bind", () => {
  const r = loadConfig({ AUTH_MODE: "none", BIND_HOST: "0.0.0.0" });
  assert.equal(r.ok, false);
  assert.match(r.output, /loopback/);
});
