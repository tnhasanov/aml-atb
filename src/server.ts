import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";

import { config } from "./config.js";
import { corpus, getClauseTree } from "./rules.js";
import { runTurn, type StreamEvent } from "./agent.js";
import { audit, initAudit, auditFailure } from "./audit.js";
import { authenticate, type Principal } from "./auth.js";
import { listToolNames } from "./tools/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(here, "..", "..", "public");
export const VERSION = "0.2.0";

/**
 * In-memory session store, keyed by (principal, session id) so one user cannot
 * resume another's conversation by supplying their id. Single-process by
 * design; see the non-goals in the README.
 */
interface Session {
  owner: string;
  history: Anthropic.MessageParam[];
  lastSeen: number;
}
const sessions = new Map<string, Session>();

function sessionKey(user: string, id: string): string {
  return `${user} ${id}`;
}

function evictStale(): void {
  const cutoff = Date.now() - config.sessionIdleMs;
  for (const [key, session] of sessions) {
    if (session.lastSeen < cutoff) sessions.delete(key);
  }
  // Hard cap as a backstop against many short-lived sessions.
  if (sessions.size > config.maxSessions) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    for (const [key] of oldest.slice(0, sessions.size - config.maxSessions)) sessions.delete(key);
  }
}

/**
 * Trim whole turns.
 *
 * Removing messages one at a time can leave an assistant message at index 0,
 * which the API rejects ("first message must use the 'user' role"), or strand a
 * tool_result whose tool_use has gone. Both surface as a 400 on the user's next
 * question, mid-case. Cutting at a plain user message keeps every
 * user/assistant/tool_use/tool_result group intact.
 */
export function trimHistory(history: Anthropic.MessageParam[]): void {
  if (history.length <= config.maxHistoryMessages) return;

  for (let i = 1; i < history.length; i++) {
    const message = history[i]!;
    if (message.role !== "user" || carriesToolResult(message)) continue;
    if (history.length - i <= config.maxHistoryMessages) {
      history.splice(0, i);
      return;
    }
  }
  // No suitable boundary (one enormous turn): keep only the newest user message.
  const lastUser = history.findLastIndex((m) => m.role === "user" && !carriesToolResult(m));
  if (lastUser > 0) history.splice(0, lastUser);
}

function carriesToolResult(message: Anthropic.MessageParam): boolean {
  return (
    Array.isArray(message.content) &&
    message.content.some((block: any) => block?.type === "tool_result")
  );
}

// ---------------------------------------------------------------- throttling
const buckets = new Map<string, number[]>();
let inFlight = 0;

function rateLimited(user: string): boolean {
  const now = Date.now();
  const recent = (buckets.get(user) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= config.rateLimitPerMinute) {
    buckets.set(user, recent);
    return true;
  }
  recent.push(now);
  buckets.set(user, recent);
  return false;
}

// ---------------------------------------------------------------- http
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

export const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  const requestId = randomUUID().slice(0, 8);
  let status = 500;

  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Liveness is deliberately public so a load balancer can probe it without
    // credentials. It reveals nothing beyond "the process is up".
    if (url.pathname === "/healthz") {
      status = 200;
      return json(res, 200, { status: "ok", version: VERSION });
    }

    if (url.pathname === "/readyz") {
      const failure = auditFailure();
      status = failure ? 503 : 200;
      return json(res, status, {
        status: failure ? "degraded" : "ready",
        audit: config.auditMode,
        // Only meaningful when a trail is being kept; reporting `true` for a
        // deployment that writes nothing would read as a false assurance.
        ...(config.auditMode === "file" ? { audit_writable: !failure } : {}),
        clauses: corpus.clauses.length,
      });
    }

    // Everything else requires an authenticated caller.
    const auth = authenticate(req);
    if (!auth.ok) {
      status = auth.status;
      // Basic mode returns a WWW-Authenticate challenge here; without it the
      // browser shows a bare JSON error and offers no way to sign in.
      return json(res, auth.status, { error: auth.message }, auth.headers);
    }
    const principal = auth.principal;

    if (req.method === "GET" && url.pathname === "/api/health") {
      status = 200;
      return json(res, 200, {
        status: "ok",
        version: VERSION,
        model: config.model,
        effort: config.effort,
        tools: listToolNames(),
        user: principal.user,
        // Drives the pilot banner in the UI: if nothing is being recorded, the
        // person typing needs to know before they paste a customer name.
        audit: config.auditMode,
        source: {
          id: corpus.document.id,
          title_az: corpus.document.title_az,
          date: corpus.document.date,
          clauses: corpus.clauses.length,
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/source") {
      status = 200;
      return json(res, 200, { document: corpus.document, parts: corpus.parts });
    }

    // Backs the clickable clause references in the transcript.
    if (req.method === "GET" && url.pathname === "/api/clause") {
      const id = url.searchParams.get("id")?.trim() ?? "";
      const tree = getClauseTree(id);
      if (!tree.length) {
        status = 404;
        return json(res, 404, {
          error:
            `Bu sənəddə ${id} nömrəli bənd yoxdur. Bəndlər 1.1-dən 8.3-ə qədərdir; ` +
            `göstərilən nömrə Qanuna və ya digər normativ sənədə istinad ola bilər.`,
        });
      }
      status = 200;
      return json(res, 200, {
        clause_id: id,
        part_title_az: tree[0]!.part_title_az,
        clauses: tree.map((c) => ({ clause_id: c.id, text: c.text })),
      });
    }

    if (req.method === "DELETE" && url.pathname === "/api/session") {
      const id = url.searchParams.get("id")?.trim() ?? "";
      sessions.delete(sessionKey(principal.user, id));
      status = 204;
      res.writeHead(204).end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      status = await handleChat(req, res, principal);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      status = await serveStatic(url.pathname, res, req.method === "HEAD");
      return;
    }

    status = 405;
    json(res, 405, { error: "Metod dəstəklənmir" });
  } catch (err) {
    console.error(`[server] req=${requestId}`, err);
    if (!res.headersSent) json(res, 500, { error: "Daxili xəta" });
    else res.end();
  } finally {
    // One structured line per request: without it nothing ties an HTTP call to
    // an audit record when something has to be reconstructed later.
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        req_id: requestId,
        method: req.method,
        path: (req.url ?? "").split("?")[0],
        status,
        ms: Date.now() - startedAt,
      }),
    );
  }
});

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  principal: Principal,
): Promise<number> {
  // A JSON body sent as text/plain is a CORS "simple request", so any page the
  // user visits could otherwise drive this endpoint from their browser.
  const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType !== "application/json") {
    json(res, 415, { error: "Content-Type application/json olmalıdır" });
    return 415;
  }

  const failure = auditFailure();
  if (failure && config.auditFailClosed) {
    json(res, 503, {
      error:
        "Audit jurnalı yazıla bilmir, ona görə sorğular qəbul edilmir. İT dəstəyi ilə əlaqə saxlayın.",
    });
    return 503;
  }

  if (rateLimited(principal.user)) {
    json(res, 429, { error: "Sorğu həddi aşılıb. Bir qədər gözləyin." });
    return 429;
  }
  if (inFlight >= config.maxConcurrentTurns) {
    json(res, 429, { error: "Sistem yüklüdür. Bir qədər sonra yenidən cəhd edin." });
    return 429;
  }

  let body: string;
  try {
    body = await readBody(req);
  } catch {
    json(res, 413, { error: "Sorğu həddindən artıq böyükdür" });
    return 413;
  }

  let payload: { message?: string; session_id?: string };
  try {
    payload = JSON.parse(body);
  } catch {
    json(res, 400, { error: "Sorğunun məzmunu JSON formatında olmalıdır" });
    return 400;
  }

  const message = (payload.message ?? "").trim();
  if (!message) {
    json(res, 400, { error: "Mesaj mətni tələb olunur" });
    return 400;
  }
  if (message.length > config.maxMessageChars) {
    json(res, 413, { error: "Mesaj həddindən artıq uzundur" });
    return 413;
  }

  // The session id is only ever minted server-side, and is looked up under the
  // authenticated user - so presenting someone else's id yields nothing.
  evictStale();
  const requestedId = payload.session_id?.trim();
  let sessionId: string;
  let session: Session;

  if (requestedId) {
    const existing = sessions.get(sessionKey(principal.user, requestedId));
    if (!existing) {
      json(res, 404, { error: "Sessiya tapılmadı və ya vaxtı bitib. Yeni sessiya başladın." });
      return 404;
    }
    sessionId = requestedId;
    session = existing;
  } else {
    sessionId = randomUUID();
    session = { owner: principal.user, history: [], lastSeen: Date.now() };
    sessions.set(sessionKey(principal.user, sessionId), session);
    audit({ type: "session_started", session_id: sessionId }, principal);
  }
  session.lastSeen = Date.now();

  audit({ type: "user_message", session_id: sessionId, message }, principal);
  session.history.push({ role: "user", content: message });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: StreamEvent | { type: "session"; session_id: string }) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  send({ type: "session", session_id: sessionId });

  // Abandon the upstream call if the browser goes away: otherwise the model
  // keeps generating into a dead socket, spending money invisibly.
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  inFlight++;
  try {
    await runTurn(sessionId, session.history, send, {
      principal,
      signal: controller.signal,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (!controller.signal.aborted) {
      console.error("[chat]", detail);
      audit({ type: "error", session_id: sessionId, message: detail }, principal);
      send({ type: "error", message: userFacingError(detail) });
    }
  } finally {
    inFlight--;
    trimHistory(session.history);
    if (!res.writableEnded) res.end();
  }
  return 200;
}

/**
 * Never interpolate upstream detail into a client-facing string: an SDK error
 * can carry the API key verbatim, and anything sent here is also written into
 * the hash-chained audit file, where it cannot be removed afterwards.
 */
export function userFacingError(detail: string): string {
  if (/api[-_ ]?key|authentication|401|invalid header/i.test(detail)) {
    return "Model xidmətinə qoşulma alınmadı (autentifikasiya). İT dəstəyi ilə əlaqə saxlayın.";
  }
  if (/rate.?limit|429/i.test(detail)) {
    return "Model xidmətinin sorğu həddi aşılıb. Bir qədər gözləyib yenidən cəhd edin.";
  }
  if (/timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(detail)) {
    return "Model xidməti vaxtında cavab vermədi. Yenidən cəhd edin.";
  }
  return "Sorğu alınmadı. Problem davam edərsə, İT dəstəyi ilə əlaqə saxlayın.";
}

async function serveStatic(
  pathname: string,
  res: ServerResponse,
  headOnly: boolean,
): Promise<number> {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(PUBLIC_DIR, rel);

  // Confine reads to the public directory.
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
    json(res, 403, { error: "Qadağandır" });
    return 403;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      "Content-Length": String(data.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(headOnly ? undefined : data);
    return 200;
  } catch {
    json(res, 404, { error: "Tapılmadı" });
    return 404;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > config.maxRequestBytes) {
      req.destroy();
      reject(new Error("payload too large"));
      return;
    }

    let size = 0;
    const chunks: Buffer[] = [];
    let settled = false;

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.byteLength;
      if (size > config.maxRequestBytes) {
        settled = true;
        req.destroy();
        reject(new Error("payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      // Decode once at the end so a multi-byte character split across a chunk
      // boundary does not become U+FFFD - Azerbaijani text is full of them.
      resolvePromise(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function json(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers?: Record<string, string>,
): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}
