import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { TOOL_DEFINITIONS, runTool } from "./tools/index.js";
import { audit, extractCitations } from "./audit.js";
import type { Principal } from "./auth.js";

// Resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login`
// profile - in that order - without us having to plumb credentials through.
// ANTHROPIC_BASE_URL is honoured by the SDK, which is how an institutional
// gateway or DLP proxy can be interposed without a code change.
const client = new Anthropic({
  timeout: config.upstreamTimeoutMs,
  maxRetries: config.upstreamMaxRetries,
});

export type StreamEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_end"; tool: string; ok: boolean }
  | { type: "done"; citations: string[] }
  | { type: "truncated"; message: string }
  | { type: "refusal"; message: string }
  | { type: "error"; message: string };

export type Emit = (event: StreamEvent) => void;

export interface TurnOptions {
  principal: Principal;
  /** Aborts the upstream call when the browser goes away mid-stream. */
  signal?: AbortSignal;
}

/**
 * Runs one user turn to completion, driving the tool loop and streaming
 * incremental output through `emit`.
 *
 * A manual loop rather than the SDK tool runner: every tool call has to be
 * written to the audit trail and surfaced in the UI as it happens, and we want
 * an explicit iteration ceiling.
 *
 * `history` is mutated in place so the caller's session store keeps the full
 * transcript, including tool_use and tool_result blocks.
 */
export async function runTurn(
  sessionId: string,
  history: Anthropic.MessageParam[],
  emit: Emit,
  options: TurnOptions,
): Promise<void> {
  const { principal, signal } = options;
  let answerText = "";

  for (let iteration = 0; iteration < config.maxToolIterations; iteration++) {
    if (signal?.aborted) return;

    const stream = client.messages.stream(
      {
        model: config.model,
        max_tokens: config.maxTokens,
        // Array form so the frozen prompt + tool definitions cache together.
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: config.effort },
        tools: TOOL_DEFINITIONS,
        messages: history,
      },
      { signal },
    );

    stream.on("thinking", (delta) => emit({ type: "thinking", text: delta }));
    stream.on("text", (delta) => {
      answerText += delta;
      emit({ type: "text", text: delta });
    });

    const message = await stream.finalMessage();

    audit(
      {
        type: "usage",
        session_id: sessionId,
        model: message.model,
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
      },
      principal,
    );

    if (message.stop_reason === "refusal") {
      const note =
        "Bu sorğu modelin təhlükəsizlik sistemi tərəfindən rədd edildi. Sualı yenidən " +
        "formalaşdırın və ya konkret iş üzrədirsə, MLRO-ya müraciət edin.";
      audit({ type: "error", session_id: sessionId, message: "stop_reason=refusal" }, principal);
      emit({ type: "refusal", message: note });
      return;
    }

    /**
     * Truncation is not an answer. Treating it as one would hand a compliance
     * officer a CDD analysis cut off before "however, enhanced due diligence
     * applies" and hash-chain it into the record as the advice given.
     */
    if (message.stop_reason === "max_tokens") {
      const note =
        "Cavab uzunluq həddinə çatdığı üçün yarımçıq kəsildi və tam sayılmamalıdır. " +
        "Sualı daha dar verin və ya AML_MAX_TOKENS həddini artırın.";
      audit(
        { type: "error", session_id: sessionId, message: "stop_reason=max_tokens (truncated)" },
        principal,
      );
      // Do not keep a truncated turn in history: if the cut landed inside a
      // tool_use block it has no matching tool_result and every later turn 400s.
      emit({ type: "truncated", message: note });
      return;
    }

    history.push({ role: "assistant", content: message.content });

    if (message.stop_reason !== "tool_use") {
      const citations = extractCitations(answerText);
      audit(
        { type: "assistant_message", session_id: sessionId, message: answerText, citations },
        principal,
      );
      emit({ type: "done", citations });
      return;
    }

    // Execute every requested tool, then return all results in one user turn -
    // splitting them across messages trains the model out of parallel calls.
    const toolUses = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const input = (use.input ?? {}) as Record<string, unknown>;
      emit({ type: "tool_start", tool: use.name, input });
      audit({ type: "tool_call", session_id: sessionId, tool: use.name, input }, principal);

      const result = runTool(use.name, input);

      audit(
        {
          type: "tool_result",
          session_id: sessionId,
          tool: use.name,
          ok: result.ok !== false,
          summary: summarise(result),
        },
        principal,
      );
      emit({ type: "tool_end", tool: use.name, ok: result.ok !== false });

      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(result),
        is_error: result.ok === false,
      });
    }

    history.push({ role: "user", content: results });
  }

  const message =
    `${config.maxToolIterations} alət dövrəsindən sonra cavab formalaşmadı. ` +
    `Sualı daha dəqiq ifadə etməyə çalışın.`;
  audit({ type: "error", session_id: sessionId, message }, principal);
  emit({ type: "error", message });
}

/** Keep audit records readable - full clause text belongs in the corpus, not the log. */
function summarise(result: Record<string, unknown>): unknown {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if ((key === "neticeler" || key === "bendler") && Array.isArray(value)) {
      out[`${key}_bendleri`] = value.map((r: any) => r?.bend).filter(Boolean);
    } else if (typeof value === "string" && value.length > 300) {
      out[key] = `${value.slice(0, 300)}...`;
    } else {
      out[key] = value;
    }
  }
  return out;
}
