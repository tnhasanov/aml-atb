import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { config } from "./config.js";
import { verifyPassword } from "./password.js";

/**
 * Who is asking.
 *
 * Every audit record carries one of these. An AML record-keeping trail that
 * cannot answer "who asked this" does not do the job the regulation expects of
 * it, so identity is resolved once here and threaded through everything.
 */
export interface Principal {
  user: string;
  ip: string;
}

export type AuthResult =
  | { ok: true; principal: Principal }
  /** `headers` carries the Basic challenge, so the browser offers a sign-in box. */
  | { ok: false; status: 401 | 403; message: string; headers?: Record<string, string> };

/**
 * Identity is terminated at the reverse proxy (SSO/OIDC/client certs) and
 * passed in a header. We do not implement auth protocols in this process - a
 * bank already has an IdP, and a hand-rolled one here would be worse than
 * either.
 */
export function authenticate(req: IncomingMessage): AuthResult {
  const ip = clientIp(req);

  if (config.authMode === "none") {
    // Only reachable on a loopback bind; buildConfig() refuses otherwise.
    return { ok: true, principal: { user: "dev@localhost", ip } };
  }

  if (config.authMode === "basic") return basic(req, ip);

  if (config.authSharedSecret) {
    const presented = header(req, config.authSecretHeader);
    if (!presented || !constantTimeEquals(presented, config.authSharedSecret)) {
      return {
        ok: false,
        status: 403,
        message: "Sorğu etibarlı proksi vasitəsilə gəlmədi.",
      };
    }
  }

  const user = header(req, config.authUserHeader);
  if (!user) {
    return {
      ok: false,
      status: 401,
      message: "Autentifikasiya tələb olunur. Sistemə daxil olun.",
    };
  }

  // A header carrying a newline or a comma is either a proxy misconfiguration
  // or an attempt to smuggle a second value; neither should become an identity.
  if (!/^[\w.@+-]{1,128}$/.test(user)) {
    return { ok: false, status: 403, message: "İstifadəçi adı etibarsızdır." };
  }

  return { ok: true, principal: { user, ip } };
}

/**
 * HTTP Basic against the configured accounts.
 *
 * Wrong username and wrong password give the same 401 and the same text: the
 * account list is the compliance team, and telling an outsider which names are
 * on it is itself a small disclosure.
 */
function basic(req: IncomingMessage, ip: string): AuthResult {
  const challenge = {
    "WWW-Authenticate": `Basic realm="${config.authRealm.replace(/"/g, "")}", charset="UTF-8"`,
  };
  const refuse = (message: string): AuthResult => ({ ok: false, status: 401, message, headers: challenge });

  const presented = header(req, "authorization");
  if (!presented) return refuse("Autentifikasiya tələb olunur. İstifadəçi adı və şifrə ilə daxil olun.");

  const [scheme, encoded] = presented.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "basic" || !encoded) {
    return refuse("Autentifikasiya üsulu dəstəklənmir.");
  }

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return refuse("Autentifikasiya məlumatları oxunmadı.");
  }

  // The password may itself contain a colon; the username may not.
  const split = decoded.indexOf(":");
  if (split < 1) return refuse("Autentifikasiya məlumatları oxunmadı.");
  const user = decoded.slice(0, split);
  const password = decoded.slice(split + 1);

  const account = config.authAccounts.find((a) => a.user === user);
  // Verify even when there is no such account, so a nonexistent username costs
  // the same wall-clock time as a wrong password.
  const decoy = config.authAccounts[0]?.hash;
  const okPassword = account
    ? verifyPassword(password, account.hash)
    : (decoy ? verifyPassword(password, decoy) : false) && false;

  if (!account || !okPassword) {
    return refuse("İstifadəçi adı və ya şifrə yanlışdır.");
  }

  return { ok: true, principal: { user: account.user, ip } };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  const single = Array.isArray(value) ? value[0] : value;
  return single?.trim() || undefined;
}

function clientIp(req: IncomingMessage): string {
  const forwarded = header(req, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
