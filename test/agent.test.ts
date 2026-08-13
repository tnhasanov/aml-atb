import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Exercises the tool loop in src/agent.ts against a stub that speaks the
 * Messages API streaming wire format.
 *
 * The loop is the part most likely to break silently - a dropped tool_result,
 * a mishandled stop_reason, or a missing audit record would not show up in any
 * unit test, and would only surface as a wrong answer in production.
 */

interface Turn {
  /** Emitted as a tool_use block; otherwise the turn is plain text. */
  tool?: { name: string; input: unknown };
  text?: string;
}

let upstream: Server;
let received: any[] = [];
let script: Turn[] = [];

function sse(res: any, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function respond(res: any, turn: Turn): void {
  res.writeHead(200, { "Content-Type": "text/event-stream" });

  sse(res, "message_start", {
    type: "message_start",
    message: {
      id: "msg_stub",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-stub",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 11, output_tokens: 0 },
    },
  });

  if (turn.tool) {
    sse(res, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_stub_1", name: turn.tool.name, input: {} },
    });
    sse(res, "content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(turn.tool.input) },
    });
    sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
    sse(res, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 7 },
    });
  } else {
    sse(res, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    // Split so the test also proves deltas are streamed, not buffered.
    for (const chunk of chunkText(turn.text ?? "")) {
      sse(res, "content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: chunk },
      });
    }
    sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
    sse(res, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 12 },
    });
  }

  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

function chunkText(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 16) out.push(text.slice(i, i + 16));
  return out.length ? out : [""];
}

before(async () => {
  upstream = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(JSON.parse(body || "{}"));
      respond(res, script.shift() ?? { text: "fallback" });
    });
  });

  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const { port } = upstream.address() as AddressInfo;

  // Must be set before src/agent.ts constructs its client at module load.
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.AUDIT_DIR = "./audit/test";
});

after(() => {
  upstream?.close();
});

test("a tool-using turn calls the tool, feeds the result back, and streams the answer", async (t) => {
  const { runTurn } = await import("../src/agent.js");

  received = [];
  script = [
    { tool: { name: "search_rules", input: { query: "politically exposed persons" } } },
    { text: "Enhanced measures are mandatory under clause 5.2 for PEPs." },
  ];

  const events: any[] = [];
  const history: Anthropic.MessageParam[] = [{ role: "user", content: "What applies to PEPs?" }];

  await runTurn("test-session", history, (e) => events.push(e));

  const types = events.map((e) => e.type);
  assert.ok(types.includes("tool_start"), "tool_start should be emitted");
  assert.ok(types.includes("tool_end"), "tool_end should be emitted");
  assert.ok(types.includes("text"), "text deltas should be emitted");
  assert.equal(types.at(-1), "done");

  const toolStart = events.find((e) => e.type === "tool_start");
  assert.equal(toolStart.tool, "search_rules");
  assert.equal(events.find((e) => e.type === "tool_end").ok, true);

  const answer = events
    .filter((e) => e.type === "text")
    .map((e) => e.text)
    .join("");
  assert.match(answer, /clause 5\.2/);

  // The citation is extracted for the audit record.
  assert.deepEqual(events.at(-1).citations, ["5.2"]);

  // Two upstream calls: the tool turn, then the answer turn.
  assert.equal(received.length, 2);

  // History must carry assistant tool_use and the matching user tool_result,
  // or the next turn would be rejected by the API.
  assert.equal(history.length, 4);
  assert.equal(history[1]!.role, "assistant");
  assert.equal(history[2]!.role, "user");
  const toolResult = (history[2]!.content as any[])[0];
  assert.equal(toolResult.type, "tool_result");
  assert.equal(toolResult.tool_use_id, "toolu_stub_1");
  assert.match(toolResult.content, /clause_id/);
});

test("request carries the cached system prompt, tools, adaptive thinking and effort", async () => {
  const { runTurn } = await import("../src/agent.js");

  received = [];
  script = [{ text: "ok" }];
  await runTurn("test-session-2", [{ role: "user", content: "hello" }], () => {});

  const req = received[0];
  assert.equal(req.stream, true);
  assert.equal(req.thinking.type, "adaptive");
  assert.ok(req.output_config.effort, "effort should be set");
  assert.equal(req.system[0].cache_control.type, "ephemeral", "system prompt should be cached");
  assert.ok(req.tools.length >= 5, "tool definitions should be sent");
  assert.ok(
    req.system[0].text.includes("Maliyyə Monitorinqi Xidməti"),
    "system prompt should name the source regulation",
  );
});

test("a refusal stop_reason surfaces as a refusal event, not a silent empty answer", async () => {
  const { runTurn } = await import("../src/agent.js");

  received = [];
  script = [];
  // Override once with a refusal turn.
  const original = upstream.listeners("request")[0] as any;
  upstream.removeAllListeners("request");
  upstream.on("request", (req: any, res: any) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      sse(res, "message_start", {
        type: "message_start",
        message: {
          id: "msg_refusal",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-stub",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 0 },
        },
      });
      sse(res, "message_delta", {
        type: "message_delta",
        delta: { stop_reason: "refusal", stop_sequence: null },
        usage: { output_tokens: 0 },
      });
      sse(res, "message_stop", { type: "message_stop" });
      res.end();
    });
  });

  const events: any[] = [];
  await runTurn("test-session-3", [{ role: "user", content: "x" }], (e) => events.push(e));

  assert.equal(events.at(-1).type, "refusal");
  assert.match(events.at(-1).message, /MLRO/);

  upstream.removeAllListeners("request");
  upstream.on("request", original);
});
