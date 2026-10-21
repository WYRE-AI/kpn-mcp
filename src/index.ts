#!/usr/bin/env node
/**
 * KPN MCP server — Grexx IRMA realtime tools, legacy developer.kpn.com opt-in.
 *
 * Transports:
 * - stdio (default): local Claude Desktop / CLI usage. `serveStdio` owns the
 *   era decision: a 2025-era `initialize` pins the connection legacy; modern
 *   2026-07-28 envelope openings are served natively.
 * - http: hosted deployment. `createMcpHandler({ legacy: 'stateless' })` is
 *   the dual-era posture — 2025-era traffic answered per-request statelessly,
 *   modern envelope traffic natively. NEVER `legacy: 'reject'`.
 *
 * Credentials via environment variables (env mode):
 * - KPN_GREXX_USERNAME / KPN_GREXX_PASSWORD / KPN_GREXX_BASE_URL (required)
 * - KPN_GREXX_TOKEN_URL (optional; acceptatie default inside node-kpn)
 * Gateway headers (AUTH_MODE=gateway):
 * - X-KPN-Grexx-Username / X-KPN-Grexx-Password (required)
 * - X-Grexx-Api-Url + X-Grexx-Token-Url (optional, both or neither; per-connection
 *   Grexx environment, allowlisted hosts only, SSRF-guarded). Absent: env URLs.
 * Any other URL header is rejected (400).
 * Set KPN_LEGACY_DEVELOPER_API=1 to also serve developer.kpn.com tools.
 *
 * HTTP transport refuses to start unless CONDUIT_S2S_SECRET is a real secret.
 * Known placeholders are rejected, including when MCP_ALLOW_INSECURE_DEV=1.
 * That flag is the only bypass for an empty secret: it logs a warning, does
 * not enforce X-Gateway-S2S, and listens on 127.0.0.1 only. A configured
 * secret still honors MCP_HTTP_HOST. /health and /healthz stay
 * unauthenticated. stdio does not use S2S auth.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  GATEWAY_HEADERS,
  LEGACY_DEVELOPER_API_ENABLED,
  REQUIRED_GATEWAY_HEADERS,
  createMcpServer,
  packageVersion,
  makeMcpServerFactory,
  resolveEnvCredentials,
  resolveGatewayCredentials,
} from "./mcp-server.js";
import { logger } from "./utils/logger.js";
import { verifyS2sHeader, S2S_HEADER } from "./s2s-verify.js";

/**
 * Public example values. A copied placeholder must not verify as a real secret,
 * and MCP_ALLOW_INSECURE_DEV=1 does not accept one.
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "replace-with-a-real-secret",
  "your-s2s-secret",
  "your-secret",
  "changeme",
  "change-me",
  "placeholder",
  "secret",
  "example",
  "replace-me",
  "s2s-secret",
]);

const LOOPBACK_HOST = "127.0.0.1";

const MISSING_S2S_SECRET_ERROR =
  "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is empty. " +
  "An empty secret would accept unauthenticated /mcp requests (CWE-306). " +
  "Set CONDUIT_S2S_SECRET to the gateway-provisioned service-to-service secret, " +
  "or set MCP_ALLOW_INSECURE_DEV=1 for local development only.";

const PLACEHOLDER_S2S_SECRET_ERROR =
  "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder. " +
  "Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value. " +
  "MCP_ALLOW_INSECURE_DEV=1 does not accept a placeholder.";

const INSECURE_DEV_WARNING =
  "SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. " +
  "HTTP /mcp is starting WITHOUT service-to-service authentication and listens on 127.0.0.1 only. " +
  "Do not use MCP_ALLOW_INSECURE_DEV outside local development.";

export interface HttpTransport {
  server: HttpServer;
  close: () => Promise<void>;
}

function refuseStart(message: string): never {
  logger.error(message);
  process.exit(1);
}

/** 127.0.0.1, the rest of 127.0.0.0/8, localhost, and ::1. */
function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.+)\]$/, "$1");
  if (normalized === "localhost" || normalized === "::1") return true;
  const bare = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
  const parts = bare.split(".");
  if (parts.length !== 4) return false;
  if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  return parts[0] === "127";
}

/**
 * Fail closed. A known placeholder is never a configured secret, including
 * when MCP_ALLOW_INSECURE_DEV=1 is also set. Empty is the only case the dev
 * flag may bypass, and that bypass does not check X-Gateway-S2S.
 * The secret value is never written to logs.
 */
function resolveS2sSecret(env: NodeJS.ProcessEnv = process.env): { secret: string; insecureDev: boolean } {
  const raw = (env.CONDUIT_S2S_SECRET ?? "").trim();
  if (raw && KNOWN_PLACEHOLDER_SECRETS.has(raw.toLowerCase())) {
    refuseStart(PLACEHOLDER_S2S_SECRET_ERROR);
  }
  if (raw) return { secret: raw, insecureDev: false };
  if (env.MCP_ALLOW_INSECURE_DEV === "1") {
    return { secret: "", insecureDev: true };
  }
  refuseStart(MISSING_S2S_SECRET_ERROR);
}

/**
 * No real secret: force 127.0.0.1, even when MCP_HTTP_HOST is a wider address
 * such as 0.0.0.0. A configured secret honors MCP_HTTP_HOST. Unset stays
 * 0.0.0.0 so a secret-backed container deploy keeps the previous bind.
 */
function resolveBindHost(insecureDev: boolean, env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.MCP_HTTP_HOST ?? "").trim();
  if (!insecureDev) return configured || "0.0.0.0";
  if (configured && !isLoopbackBindHost(configured)) {
    logger.error(
      `WARNING: MCP_HTTP_HOST=${configured} is not a loopback address. ` +
        "MCP_ALLOW_INSECURE_DEV=1 without CONDUIT_S2S_SECRET cannot listen there. " +
        `Binding ${LOOPBACK_HOST} only.`
    );
  }
  return LOOPBACK_HOST;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

const CORS_ALLOW_HEADERS = [
  "Content-Type",
  "Accept",
  "Authorization",
  "Mcp-Session-Id",
  "Mcp-Protocol-Version",
  ...GATEWAY_HEADERS,
].join(", ");

/** stdio (default). Fresh server per process; env-mode credentials. */
function startStdioTransport(): void {
  serveStdio(() => createMcpServer(resolveEnvCredentials()), {
    onerror: (error) => logger.error("stdio serving error", { error: error.message }),
  });
  logger.info("KPN MCP server running on stdio");
}

/** Start dual-era HTTP serving with health routing, gateway credential gates, and graceful shutdown. */
export async function startHttpTransport(): Promise<HttpTransport> {
  const { secret: s2sSecret, insecureDev } = resolveS2sSecret();
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  // Loopback unless the operator opts into a wider bind. A wider bind is
  // honored only when CONDUIT_S2S_SECRET is a real secret. The insecure-dev
  // bypass always listens on 127.0.0.1, including when the image sets 0.0.0.0.
  const host = resolveBindHost(insecureDev);
  if (insecureDev) {
    // error level so LOG_LEVEL=warn|error cannot hide the bypass.
    logger.error(INSECURE_DEV_WARNING);
  }
  const isGatewayMode = process.env.AUTH_MODE === "gateway";

  const mcpHandler = createMcpHandler(makeMcpServerFactory({ gatewayMode: isGatewayMode }), {
    legacy: "stateless",
    onerror: (error) => logger.error("MCP serving error", { error: error.message }),
  });
  const handleMcpRequest = toNodeHandler(mcpHandler, {
    onerror: (error) => logger.error("MCP request adapter error", { error: error.message }),
  });

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS for claude.ai custom connectors — set on every response, before routing.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // Health endpoint — shallow, unauthenticated liveness probe. Must NOT
    // touch credentials or any upstream: in gateway mode credentials only
    // arrive per-request via headers, so a credential check here would
    // always fail and crash-loop the container.
    if (url.pathname === "/health" || url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          version: packageVersion(),
          mcpTransport: "http",
          authMode: isGatewayMode ? "gateway" : "env",
          legacyDeveloperApi: LEGACY_DEVELOPER_API_ENABLED,
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // Empty s2sSecret is only reachable when MCP_ALLOW_INSECURE_DEV=1; startup
    // refuses otherwise. A configured secret is always enforced, before any
    // credential extraction.
    if (s2sSecret && !verifyS2sHeader(headerValue(req.headers[S2S_HEADER]), s2sSecret)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.",
        })
      );
      return;
    }

    if (url.pathname === "/mcp") {
      // 401 gate: reject unauthenticated gateway traffic BEFORE serving —
      // falling through to env-configured credentials would serve the
      // operator's tenant data to whoever asked (cross-tenant leak). A half
      // MSM pair is rejected too, rather than silently using the main pair.
      if (isGatewayMode) {
        const resolved = resolveGatewayCredentials((name) => req.headers[name]);
        if (resolved.rejectedUrl) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32600, message: resolved.rejectedUrlError },
              id: null,
            })
          );
          return;
        }
        const unauthorized = resolved.grexxError ?? resolved.legacyError;
        if (unauthorized) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32001,
                message: `Unauthorized: ${unauthorized}`,
                data: { required: REQUIRED_GATEWAY_HEADERS },
              },
              id: null,
            })
          );
          return;
        }
      }

      // Per-request credential binding happens inside the factory (it reads
      // the gateway headers from ctx.requestInfo on every request).
      await handleMcpRequest(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", endpoints: ["/mcp", "/health"] }));
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      logger.info(`KPN MCP server listening on http://${host}:${port}/mcp`);
      logger.info(`Health check available at http://${host}:${port}/health`);
      logger.info(`Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env"}`);
      resolve();
    });
  });

  return {
    server: httpServer,
    close: async () => {
      await mcpHandler.close();
      if (!httpServer.listening) return;
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

async function main() {
  const transportType = process.env.MCP_TRANSPORT || "stdio";
  logger.info("Starting KPN MCP server", {
    transport: transportType,
    nodeVersion: process.version,
  });

  if (transportType === "http") {
    const http = await startHttpTransport();
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info("Shutting down KPN MCP server...");
      try {
        await http.close();
        process.exit(0);
      } catch (error) {
        logger.error("Shutdown error", { error: error instanceof Error ? error.message : String(error) });
        process.exit(1);
      }
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } else {
    startStdioTransport();
  }
}

// Vitest imports this module to call startHttpTransport. Skip the CLI
// entrypoint there. `node dist/index.js` still starts stdio or HTTP.
if (process.env.VITEST !== "true") {
  main().catch((error) => {
    logger.error("Fatal startup error", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
