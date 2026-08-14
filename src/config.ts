import { isAbsolute, resolve } from "node:path";
import { parseAuthUsers, type Account } from "./password.js";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Empty and whitespace-only env vars are treated as unset, not as "". */
function env(name: string): string | undefined {
  const raw = process.env[name];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function bool(name: string, fallback: boolean): boolean {
  const v = env(name)?.toLowerCase();
  if (v === undefined) return fallback;
  return v === "1" || v === "true" || v === "yes";
}

function int(name: string, fallback: number): number {
  const v = env(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ConfigError(`${name} must be an integer, got "${v}"`);
  return n;
}

export class ConfigError extends Error {}

/**
 * `proxy`  - a reverse proxy in front terminates TLS and SSO and passes a
 *            verified user in a header. This is the intended deployment.
 * `basic`  - HTTP Basic against a short list of named accounts in AUTH_USERS.
 *            For hosted pilots (Render/Railway/Fly) where the platform
 *            terminates TLS but there is no IdP integration. See docs/HOSTING.md.
 * `none`   - no authentication. Development only; refuses to run on a
 *            non-loopback bind so it cannot be reached from the network.
 */
export type AuthMode = "proxy" | "basic" | "none";
const AUTH_MODES: AuthMode[] = ["proxy", "basic", "none"];

/**
 * Platforms whose filesystem does not survive the request that wrote to it.
 *
 * The audit trail is an append-only hash chain on local disk with a single
 * writer. On a serverless platform each invocation may get a fresh container,
 * several may run at once, and anything written is discarded - so the tool
 * would appear to work while keeping no usable record at all, and the chain
 * would fail verification. That is a worse outcome than refusing to start,
 * because nobody notices until a supervisor asks for the records.
 */
function detectEphemeralHost(): string | null {
  if (process.env.VERCEL) return "Vercel";
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return "AWS Lambda";
  if (process.env.NETLIFY) return "Netlify";
  if (process.env.FUNCTION_TARGET || process.env.K_SERVICE) return "Cloud Functions / Cloud Run";
  return null;
}

function buildConfig() {
  const model = env("AML_MODEL") ?? "claude-opus-5";

  const effort = (env("AML_EFFORT") ?? "high") as Effort;
  if (!EFFORTS.includes(effort)) {
    throw new ConfigError(`AML_EFFORT must be one of ${EFFORTS.join(", ")}, got "${effort}"`);
  }

  const port = int("PORT", 3000);
  if (port < 0 || port > 65535) throw new ConfigError(`PORT out of range: ${port}`);

  // Loopback by default: exposure to the network must be a deliberate act,
  // not the consequence of forgetting a firewall rule.
  const bindHost = env("BIND_HOST") ?? "127.0.0.1";

  const authMode = (env("AUTH_MODE") ?? "proxy") as AuthMode;
  if (!AUTH_MODES.includes(authMode)) {
    throw new ConfigError(`AUTH_MODE must be one of ${AUTH_MODES.join(", ")}, got "${authMode}"`);
  }

  const loopback = bindHost === "127.0.0.1" || bindHost === "::1" || bindHost === "localhost";
  if (authMode === "none" && !loopback) {
    throw new ConfigError(
      `AUTH_MODE=none is only permitted on a loopback bind, but BIND_HOST is "${bindHost}". ` +
        `An unauthenticated AML assistant must not be reachable from the network.`,
    );
  }

  let authAccounts: Account[] = [];
  if (authMode === "basic") {
    const spec = env("AUTH_USERS");
    if (!spec) {
      throw new ConfigError(
        "AUTH_MODE=basic requires AUTH_USERS. Generate an entry with: node tools/hash-password.mjs <username>",
      );
    }
    try {
      authAccounts = parseAuthUsers(spec);
    } catch (err) {
      throw new ConfigError(err instanceof Error ? err.message : String(err));
    }
    if (!authAccounts.length) throw new ConfigError("AUTH_USERS is set but lists no accounts");
  }

  const auditDirRaw = env("AUDIT_DIR") ?? "./audit";
  const auditDir = isAbsolute(auditDirRaw) ? auditDirRaw : resolve(process.cwd(), auditDirRaw);

  /**
   * `file` - the append-only hash-chained trail. Required wherever real
   *          customer data is entered.
   * `off`  - keep no record of questions or answers at all. For a pilot on
   *          synthetic cases, where a durable disk is a cost with no benefit.
   *          The UI says so, because the risk of this mode is that someone
   *          pastes a real customer name into a tool that keeps no record of it.
   */
  const auditMode = (env("AUDIT_MODE") ?? "file") as "file" | "off";
  if (auditMode !== "file" && auditMode !== "off") {
    throw new ConfigError(`AUDIT_MODE must be "file" or "off", got "${auditMode}"`);
  }

  // Only a durable trail cares where it is running; with AUDIT_MODE=off there
  // is nothing to lose to an ephemeral filesystem.
  const ephemeralHost = auditMode === "off" ? null : detectEphemeralHost();
  if (ephemeralHost && !bool("AML_ALLOW_EPHEMERAL_AUDIT", false)) {
    throw new ConfigError(
      `This looks like ${ephemeralHost}, where the filesystem is discarded between ` +
        `invocations and several instances may run at once. The audit trail at ${auditDir} ` +
        `is an append-only hash chain that needs one writer and a durable disk, so it would ` +
        `be silently lost and would fail verification. Deploy on a platform with a persistent ` +
        `volume instead - see docs/HOSTING.md. Set AML_ALLOW_EPHEMERAL_AUDIT=1 only for a ` +
        `throwaway demo where no real customer data is entered.`,
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && /\s/.test(apiKey)) {
    throw new ConfigError(
      "ANTHROPIC_API_KEY contains whitespace. A multi-line value in .env produces an " +
        "invalid header and leaks the key into error text.",
    );
  }

  return {
    model,
    effort,
    port,
    bindHost,
    isLoopback: loopback,
    authMode,
    /** Header the reverse proxy sets to the authenticated username. */
    authUserHeader: (env("AUTH_USER_HEADER") ?? "x-forwarded-user").toLowerCase(),
    /**
     * Shared secret between proxy and app. Defence in depth: without it, anyone
     * who reaches the port directly can assert any identity by setting the
     * header themselves.
     */
    authSharedSecret: env("AUTH_SHARED_SECRET"),
    authSecretHeader: (env("AUTH_SECRET_HEADER") ?? "x-auth-secret").toLowerCase(),
    /** Named accounts for AUTH_MODE=basic; empty in every other mode. */
    authAccounts,
    /** Shown in the browser's sign-in dialog. */
    authRealm: env("AUTH_REALM") ?? "AML Uygunluq Komekcisi",

    /** Non-null when running somewhere the audit trail cannot be trusted. */
    ephemeralHost,

    auditDir,
    auditMode,
    /** Refuse to answer if the audit trail cannot be written. */
    auditFailClosed: bool("AUDIT_FAIL_CLOSED", true),

    maxTokens: int("AML_MAX_TOKENS", 32000),
    maxToolIterations: int("AML_MAX_TOOL_ITERATIONS", 8),
    maxHistoryMessages: int("AML_MAX_HISTORY", 40),

    /** Upstream request timeout (ms) and retry count. */
    upstreamTimeoutMs: int("AML_UPSTREAM_TIMEOUT_MS", 180_000),
    upstreamMaxRetries: int("AML_UPSTREAM_RETRIES", 1),

    /** Per-principal throttle and global concurrency ceiling. */
    rateLimitPerMinute: int("AML_RATE_LIMIT_PER_MINUTE", 12),
    maxConcurrentTurns: int("AML_MAX_CONCURRENT_TURNS", 4),

    /** Idle session eviction. */
    sessionIdleMs: int("AML_SESSION_IDLE_MS", 60 * 60 * 1000),
    maxSessions: int("AML_MAX_SESSIONS", 500),

    maxRequestBytes: int("AML_MAX_REQUEST_BYTES", 1_000_000),
    maxMessageChars: int("AML_MAX_MESSAGE_CHARS", 20_000),
  } as const;
}

export const config = buildConfig();
export type Config = typeof config;
