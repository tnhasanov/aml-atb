import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";

import { config } from "./config.js";
import { corpus, getClauseTree } from "./rules.js";
import { runTurn, type StreamEvent } from "./agent.js";
import { audit } from "./audit.js";
import { listToolNames } from "./tools/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, "..", "..", "public");

/**
 * In-memory session store. Fine for a single-process internal tool; a
 * multi-instance deployment needs a shared store, and any deployment holding
 * real customer data needs to weigh retention against the audit trail.
 */
const sessions = new Map<string, Anthropic.MessageParam[]>();

function getHistory(sessionId: string): Anthropic.MessageParam[] {
  let history = sessions.get(sessionId);
  if (!history) {
    history = [];
    sessions.set(sessionId, history);
    audit({ type: "session_started", session_id: sessionId });
  }
  return history;
}

/** Trim oldest turns, but never leave a dangling tool_use without its result. */
function trimHistory(history: Anthropic.MessageParam[]): void {
  while (history.length > config.maxHistoryMessages) {
    history.shift();
    while (history.length && startsWithToolResult(history[0]!)) {
      history.shift();
    }
  }
}

function startsWithToolResult(message: Anthropic.MessageParam): boolean {
  return (
    Array.isArray(message.content) &&
    message.content.some((block: any) => block?.type === "tool_result")
  );
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, {
        status: "ok",
        model: config.model,
        effort: config.effort,
        tools: listToolNames(),
        source: {
          id: corpus.document.id,
          title_en: corpus.document.title_en,
          date: corpus.document.date,
          clauses: corpus.clauses.length,
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/source") {
      return json(res, 200, { document: corpus.document, parts: corpus.parts });
    }

    // Backs the clickable clause references in the transcript.
    if (req.method === "GET" && url.pathname === "/api/clause") {
      const id = url.searchParams.get("id")?.trim() ?? "";
      const tree = getClauseTree(id);
      if (!tree.length) return json(res, 404, { error: `No clause ${id}` });
      return json(res, 200, {
        clause_id: id,
        part_title_en: tree[0]!.part_title_en,
        clauses: tree.map((c) => ({ clause_id: c.id, text: c.text })),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      return void (await handleChat(req, res));
    }

    if (req.method === "GET") {
      return void (await serveStatic(url.pathname, res));
    }

    json(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[server]", err);
    if (!res.headersSent) json(res, 500, { error: "Internal server error" });
    else res.end();
  }
});

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  let payload: { message?: string; session_id?: string };
  try {
    payload = JSON.parse(body);
  } catch {
    return json(res, 400, { error: "Body must be JSON" });
  }

  const message = (payload.message ?? "").trim();
  if (!message) return json(res, 400, { error: "message is required" });
  if (message.length > 20000) return json(res, 413, { error: "message too long" });

  const sessionId = payload.session_id?.trim() || randomUUID();
  const history = getHistory(sessionId);

  audit({ type: "user_message", session_id: sessionId, message });
  history.push({ role: "user", content: message });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: StreamEvent | { type: "session"; session_id: string }) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  send({ type: "session", session_id: sessionId });

  try {
    await runTurn(sessionId, history, send);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[chat]", err);
    audit({ type: "error", session_id: sessionId, message: detail });
    send({ type: "error", message: friendlyError(detail) });
  } finally {
    trimHistory(history);
    res.end();
  }
}

function friendlyError(detail: string): string {
  if (/api[-_ ]?key|authentication|401/i.test(detail)) {
    return "Not authenticated to the Anthropic API. Set ANTHROPIC_API_KEY in .env, or run `ant auth login`.";
  }
  if (/rate.?limit|429/i.test(detail)) {
    return "Rate limited by the API. Wait a moment and retry.";
  }
  return `Request failed: ${detail}`;
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const rel = pathname === "/" ? "index.html" : normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const filePath = join(PUBLIC_DIR, rel);

  // Confine reads to the public directory.
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "Forbidden" });

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("payload too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

server.listen(config.port, () => {
  console.log(`AML compliance assistant on http://localhost:${config.port}`);
  console.log(`  source : ${corpus.document.id} (${corpus.clauses.length} clauses)`);
  console.log(`  model  : ${config.model} (effort: ${config.effort})`);
  console.log(`  audit  : ${config.auditDir}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("  note   : ANTHROPIC_API_KEY not set - falling back to `ant auth login` profile");
  }
});
