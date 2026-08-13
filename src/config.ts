export const config = {
  model: process.env.AML_MODEL ?? "claude-opus-5",
  /** low | medium | high | xhigh | max - controls reasoning depth and token spend. */
  effort: process.env.AML_EFFORT ?? "high",
  port: Number(process.env.PORT ?? 3000),
  auditDir: process.env.AUDIT_DIR ?? "./audit",
  maxTokens: 8000,
  /** Guard against a runaway tool loop. */
  maxToolIterations: 8,
  /** Conversation turns retained per session. */
  maxHistoryMessages: 40,
} as const;
