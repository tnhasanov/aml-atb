import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { config } from "./config.js";

/**
 * Append-only audit trail.
 *
 * An AML advisory tool is itself subject to record-keeping expectations: a
 * supervisor asking "on what basis did this institution classify that customer
 * as low risk in March" needs an answer. Every question, tool invocation and
 * answer is therefore written as one JSON Lines record per event.
 *
 * Each record carries the SHA-256 of the previous record, so any later edit or
 * deletion inside the file breaks the chain and is detectable. This is
 * tamper-evident, not tamper-proof - it does not defend against rewriting the
 * whole file, which is a job for append-only storage or off-host shipping.
 */

export type AuditEvent =
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
    }
  | { type: "error"; session_id: string; message: string };

let previousHash = "genesis";
let ready = false;

function ensureDir(): void {
  if (ready) return;
  mkdirSync(config.auditDir, { recursive: true });
  ready = true;
}

function currentFile(): string {
  const day = new Date().toISOString().slice(0, 10);
  return join(config.auditDir, `audit-${day}.jsonl`);
}

export function audit(event: AuditEvent): void {
  try {
    ensureDir();
    const record = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      prev: previousHash,
      ...event,
    };
    const line = JSON.stringify(record);
    previousHash = createHash("sha256").update(line).digest("hex");
    appendFileSync(currentFile(), `${line}\n`, "utf8");
  } catch (err) {
    // Never let audit failure take the service down, but make it loud.
    console.error("[audit] failed to write record:", err);
  }
}

/** Clause references the assistant used, pulled out for the audit record. */
export function extractCitations(text: string): string[] {
  const matches = text.matchAll(/\b(?:clause|bənd|maddə|yarımbənd)\s*(\d+(?:\.\d+)+)/gi);
  return [...new Set([...matches].map((m) => m[1]!))];
}
