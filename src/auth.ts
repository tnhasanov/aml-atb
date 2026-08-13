import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { config } from "./config.js";

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
  | { ok: false; status: 401 | 403; message: string };

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
