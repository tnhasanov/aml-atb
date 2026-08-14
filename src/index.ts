/**
 * Process entrypoint.
 *
 * Kept separate from src/server.ts so the request handling and its helpers can
 * be imported by tests without binding a port or writing an audit record as a
 * side effect of the import.
 */
import { config } from "./config.js";
import { corpus } from "./rules.js";
import { initAudit } from "./audit.js";
import { server, VERSION } from "./server.js";

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandled rejection:", reason);
});

function shutdown(signal: string): void {
  console.log(`[server] ${signal} received, closing`);
  server.close(() => process.exit(0));
  // Do not wait forever on long-lived SSE connections.
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

try {
  initAudit(VERSION);
} catch (err) {
  console.error(`[fatal] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

server.listen(config.port, config.bindHost, () => {
  const address = server.address();
  const bound = typeof address === "string" ? address : `${address?.address}:${address?.port}`;
  console.log(`AML Uygunluq Komekcisi listening on ${bound}`);
  console.log(`  source : ${corpus.document.id} (${corpus.clauses.length} bend)`);
  console.log(`  model  : ${config.model} (effort: ${config.effort})`);
  console.log(`  audit  : ${config.auditDir}`);
  console.log(`  auth   : ${config.authMode}${config.authSharedSecret ? " + shared secret" : ""}`);
  if (config.authMode === "none") {
    console.log("  WARNING: authentication disabled - loopback only, development use");
  }
  if (config.authMode === "basic") {
    console.log(`  users  : ${config.authAccounts.map((a) => a.user).join(", ")}`);
    console.log("  note   : Basic auth sends the password on every request - the platform in");
    console.log("           front MUST terminate TLS. Production behind the bank's IdP is AUTH_MODE=proxy.");
  }
  if (config.ephemeralHost) {
    console.log(`  WARNING: ${config.ephemeralHost} detected with AML_ALLOW_EPHEMERAL_AUDIT set.`);
    console.log("           The audit trail will not survive. Demo use only - no customer data.");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("  note   : ANTHROPIC_API_KEY not set - falling back to `ant auth login` profile");
  }
});
