import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password verification for `AUTH_MODE=basic`.
 *
 * This exists for hosted pilots (Render, Railway, Fly) where there is no nginx
 * and no oauth2-proxy in front, so the header-based identity of `AUTH_MODE=proxy`
 * has nothing to trust. It is deliberately the smaller of the two options: a
 * short list of named accounts, no password reset, no lockout, no self-service.
 * Production behind the bank's IdP remains `AUTH_MODE=proxy`.
 *
 * The point that matters for the audit trail is that the username is *earned*,
 * not asserted: an audit record saying `aygun` means someone presented aygun's
 * password, not that a header said so.
 *
 * Only hashes are ever configured. `tools/hash-password.mjs` mints entries.
 */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

export interface Account {
  user: string;
  /** `scrypt$N$r$p$salt_b64$hash_b64` */
  hash: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Constant-time within a given stored hash. A wrong *username* still returns
 * false quickly, which leaks account existence by timing; that is accepted here
 * because the account list is a handful of named colleagues, not a public
 * signup surface.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Bound the work factor: these come from configuration, and an absurd N would
  // otherwise let a bad env var wedge the process on every login attempt.
  if (N < 1024 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (!salt.length || !expected.length) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Parse `AUTH_USERS`: comma-separated `username:hash` pairs.
 *
 * Throws rather than skipping a malformed entry. A typo that silently dropped
 * an account would look like "the tool forgot my password"; a typo that
 * silently dropped the *only* account would leave the service unreachable with
 * no explanation in the logs.
 */
export function parseAuthUsers(spec: string): Account[] {
  const accounts: Account[] = [];
  const seen = new Set<string>();

  for (const raw of spec.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;

    const split = entry.indexOf(":");
    if (split < 1) throw new Error(`AUTH_USERS entry is not "username:hash": "${redact(entry)}"`);

    const user = entry.slice(0, split).trim();
    const hash = entry.slice(split + 1).trim();

    if (!/^[\w.@+-]{1,128}$/.test(user)) {
      throw new Error(`AUTH_USERS username "${user}" has characters that cannot appear in an audit record`);
    }
    if (!hash.startsWith("scrypt$")) {
      throw new Error(
        `AUTH_USERS entry for "${user}" is not a scrypt hash. ` +
          `Plain passwords are not accepted; generate one with: node tools/hash-password.mjs`,
      );
    }
    if (seen.has(user)) throw new Error(`AUTH_USERS lists "${user}" twice`);

    seen.add(user);
    accounts.push({ user, hash });
  }

  return accounts;
}

function redact(entry: string): string {
  const head = entry.split(":")[0] ?? "";
  return `${head}:...`;
}
