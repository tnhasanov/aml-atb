import { appendFileSync, mkdirSync, readFileSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { config } from "./config.js";
import type { Principal } from "./auth.js";

/**
 * Append-only audit trail.
 *
 * An AML advisory tool is itself subject to record-keeping expectations: a
 * supervisor asking "on what basis did this institution classify that customer
 * as low risk in March" needs an answer, and that answer must say who asked.
 * Every question, tool invocation and answer is written as one JSON Lines
 * record per event, each carrying the acting principal.
 *
 * Each record carries the SHA-256 of the previous record, so any later edit or
 * deletion inside the file breaks the chain and is detectable. This is
 * tamper-evident, not tamper-proof - it does not defend against rewriting the
 * whole file, which is a job for append-only storage or off-host shipping.
 */

interface Actor {
  user: string;
  ip: string;
}

export type AuditEvent =
  | { type: "service_started"; pid: number; version: string }
  | { type: "session_started"; session_id: string }
  | { type: "user_message"; session_id: string; message: string }
  | { type: "tool_call"; session_id: string; tool: string; input: unknown }
  | { type: "tool_result"; session_id: string; tool: string; ok: boolean; summary: unknown }
  | { type: "assistant_message"; session_id: string; message: string; citations: string[] }
  | {
      type: "usage";
      session_id: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    }
  | { type: "error"; session_id: string; message: string };

let previousHash: string | null = null;
let currentDay: string | null = null;
let lastError: string | null = null;

/** Non-empty when the trail is broken; the server refuses new turns if so. */
export function auditFailure(): string | null {
  return lastError;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fileFor(day: string): string {
  return join(config.auditDir, `audit-${day}.jsonl`);
}

function sha256(line: string): string {
  return createHash("sha256").update(line).digest("hex");
}

function lastLineOf(path: string): string | null {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  return lines.length ? lines[lines.length - 1]! : null;
}

/**
 * Seed the chain from what is already on disk.
 *
 * Without this the module-level hash resets to "genesis" on every restart and
 * writes a break into the middle of the day's file - making a routine restart
 * indistinguishable from tampering, which defeats the entire point of the chain.
 * The seed also spans day files, so the chain is continuous across midnight.
 */
function seedChain(day: string): string {
  const own = lastLineOf(fileFor(day));
  if (own) return sha256(own);

  const earlier = readdirSync(config.auditDir)
    .filter((f) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f < `audit-${day}.jsonl`)
    .sort();
  const previousFile = earlier.at(-1);
  if (previousFile) {
    const line = lastLineOf(join(config.auditDir, previousFile));
    if (line) return sha256(line);
  }
  return "genesis";
}

/**
 * Prepare the audit directory and prove it is writable, before the service
 * accepts any traffic. An assistant giving CDD advice with no record is worse
 * than one that will not start.
 */
export function initAudit(version: string): void {
  mkdirSync(config.auditDir, { recursive: true, mode: 0o700 });
  // recursive:true will not tighten a directory that already exists.
  try {
    chmodSync(config.auditDir, 0o700);
  } catch {
    /* not fatal - ownership may not permit it */
  }
  const day = today();
  currentDay = day;
  previousHash = seedChain(day);
  lastError = null;
  audit({ type: "service_started", pid: process.pid, version });
  if (lastError) throw new Error(`Audit trail is not writable: ${lastError}`);
}

export function audit(event: AuditEvent, actor?: Principal): void {
  try {
    const day = today();
    if (day !== currentDay) {
      // Rolled past midnight: re-seed so the new file opens correctly chained.
      currentDay = day;
      previousHash = seedChain(day);
    }
    if (previousHash === null) previousHash = seedChain(day);

    const record = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      prev: previousHash,
      actor: actorOf(actor),
      ...event,
    };

    const line = JSON.stringify(redact(record));
    // Write first, advance only on success: if the append throws, the in-memory
    // hash must still match the last line actually on disk.
    appendFileSync(fileFor(day), `${line}\n`, { encoding: "utf8", mode: 0o600 });
    previousHash = sha256(line);
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error("[audit] failed to write record:", lastError);
  }
}

function actorOf(actor?: Principal): Actor {
  return actor ? { user: actor.user, ip: actor.ip } : { user: "system", ip: "local" };
}

/**
 * Last line of defence: an upstream error string can carry the API key, and a
 * record written into a hash chain cannot be deleted afterwards without
 * breaking it.
 */
function redact<T>(record: T): T {
  let json = JSON.stringify(record);
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && key.length > 8) json = json.split(key).join("[REDACTED]");
  json = json.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]");
  return JSON.parse(json) as T;
}

/** Clause references the assistant used, pulled out for the audit record. */
export function extractCitations(text: string): string[] {
  const en = [...text.matchAll(/\bclauses?\s+(\d+(?:\.\d+)+)/gi)].map((m) => m[1]!);
  const az = [...text.matchAll(/(\d+(?:\.\d+)+)(?:-(?:ci|cı|cu|cü))?\s+(?:bənd|yarımbənd)\w*/gi)].map(
    (m) => m[1]!,
  );
  return [...new Set([...en, ...az])];
}

/** Exposed for the verifier CLI and tests. */
export const _internals = { sha256, seedChain, fileFor };
