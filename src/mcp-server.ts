/**
 * Shared MCP server factory for KPN.
 *
 * This module is **side-effect free** (importing it never starts a transport)
 * so it can be reused by every entrypoint. One factory serves BOTH protocol
 * eras via the v2 SDK serving entries: legacy 2025-era clients (classic
 * `initialize` handshake) statelessly per request, and modern 2026-07-28
 * envelope clients natively.
 *
 * Statelessness is a protocol invariant here: `tools/list` returns the same
 * module-scope TOOLS array (by reference, deterministic order) for every
 * caller, every era, every request. No sessions, no per-user variance.
 */
import { Server } from "@modelcontextprotocol/server";
import type { McpServerFactory } from "@modelcontextprotocol/server";
import { KpnClient } from "@wyre-ai/node-kpn";
import { handleToolCall } from "./handlers/index.js";
import { errorResult } from "./handlers/results.js";
import { TOOLS } from "./tools/index.js";
import { logger } from "./utils/logger.js";

export const SERVER_NAME = "kpn-mcp";
export const SERVER_VERSION = "1.0.0";

export interface KpnCredentials {
  clientId: string;
  clientSecret: string;
  /** Customer GRIP-bound MSM app; the SDK falls back to clientId/clientSecret. */
  msmClientId?: string;
  msmClientSecret?: string;
  /**
   * Env mode only. Never read from a header: a caller-chosen base URL would
   * make the server send client secrets to (and fetch from) any host.
   */
  baseUrl?: string;
}

/** Exact gateway header names (design.md §2.4) — lowercased by Node on receipt. */
export const GATEWAY_HEADERS = [
  "X-KPN-Client-Id",
  "X-KPN-Client-Secret",
  "X-KPN-MSM-Client-Id",
  "X-KPN-MSM-Client-Secret",
] as const;

/** The headers every gateway request must carry (the MSM pair is optional). */
export const REQUIRED_GATEWAY_HEADERS = ["X-KPN-Client-Id", "X-KPN-Client-Secret"] as const;

/**
 * Build validated credentials from raw values. Returns `{ creds }` on
 * success or `{ error }` naming exactly what is wrong. Shared by every
 * transport (env vars, Node HTTP gateway headers). Empty strings count as
 * absent, so an unset optional header never becomes a half MSM pair.
 */
export function buildCredentials(
  clientId: string | undefined,
  clientSecret: string | undefined,
  msmClientId?: string,
  msmClientSecret?: string
): { creds?: KpnCredentials; error?: string } {
  const missing: string[] = [];
  if (!clientId) missing.push("X-KPN-Client-Id");
  if (!clientSecret) missing.push("X-KPN-Client-Secret");
  if (missing.length > 0) {
    return {
      error:
        `Missing credentials: ${missing.join(", ")} ` +
        "(or KPN_CLIENT_ID / KPN_CLIENT_SECRET in env mode)",
    };
  }
  if (Boolean(msmClientId) !== Boolean(msmClientSecret)) {
    return {
      error:
        "Incomplete MSM credentials: send both X-KPN-MSM-Client-Id and " +
        "X-KPN-MSM-Client-Secret, or neither (KPN_MSM_CLIENT_ID / KPN_MSM_CLIENT_SECRET " +
        "in env mode)",
    };
  }
  const creds: KpnCredentials = {
    clientId: clientId as string,
    clientSecret: clientSecret as string,
  };
  if (msmClientId && msmClientSecret) {
    creds.msmClientId = msmClientId;
    creds.msmClientSecret = msmClientSecret;
  }
  return { creds };
}

/** Resolve per-request gateway credentials from a (lowercased) header accessor. */
export function resolveGatewayCredentials(
  getHeader: (lowerName: string) => string | undefined
): { creds?: KpnCredentials; error?: string } {
  return buildCredentials(
    getHeader("x-kpn-client-id"),
    getHeader("x-kpn-client-secret"),
    getHeader("x-kpn-msm-client-id"),
    getHeader("x-kpn-msm-client-secret")
  );
}

/** Resolve env-mode credentials from KPN_* environment variables. */
export function resolveEnvCredentials(
  env: Record<string, string | undefined> = process.env
): { creds?: KpnCredentials; error?: string } {
  const result = buildCredentials(
    env.KPN_CLIENT_ID,
    env.KPN_CLIENT_SECRET,
    env.KPN_MSM_CLIENT_ID,
    env.KPN_MSM_CLIENT_SECRET
  );
  if (result.creds && env.KPN_BASE_URL) result.creds.baseUrl = env.KPN_BASE_URL;
  return result;
}

/**
 * Bind createMcpServer into the McpServerFactory shape the v2 HTTP serving
 * entry (createMcpHandler) consumes. The factory runs once per HTTP request —
 * the fresh-instance-per-request stateless idiom — for BOTH protocol eras.
 *
 * In gateway mode the request's headers are read from ctx.requestInfo,
 * keeping credentials bound per request. Missing headers are answered 401 by
 * the HTTP layer BEFORE serving ever starts — the factory itself never
 * throws (a throwing factory would surface as a 500).
 */
export function makeMcpServerFactory(options: { gatewayMode: boolean }): McpServerFactory {
  return (ctx) => {
    if (options.gatewayMode) {
      const { creds } = resolveGatewayCredentials(
        (name) => ctx.requestInfo?.headers.get(name) ?? undefined
      );
      return createMcpServer(creds);
    }
    const { creds } = resolveEnvCredentials();
    return createMcpServer(creds);
  };
}

// ── Pure request-handler bodies (exported for tests) ───────────────────────

export function listToolsResult(): { tools: typeof TOOLS } {
  // By reference, never rebuilt/sorted/filtered — deterministic for every caller.
  return { tools: TOOLS };
}

/**
 * Create a fresh MCP server. Called once for stdio, per-request for HTTP.
 * Credentials may be absent (e.g. env mode without vars): `tools/list` still
 * serves the full deterministic surface; `tools/call` answers a clear
 * isError result instead of throwing.
 */
export function createMcpServer(credentials?: KpnCredentials): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  // Built lazily on the first tools/call. OAuth tokens are cached process-wide
  // by the SDK (defaultTokenCache), so a fresh client per HTTP request does
  // not mint a fresh token per tool call.
  let client: KpnClient | undefined;

  server.setRequestHandler("tools/list", async () => listToolsResult());

  server.setRequestHandler("tools/call", async (request, ctx) => {
    const { name, arguments: args } = request.params;
    // Tool name only — never arguments or results (personal data, PUKs).
    logger.debug("Tool call received", { tool: name });

    if (!credentials) {
      return errorResult(
        "Missing KPN credentials. Set KPN_CLIENT_ID and KPN_CLIENT_SECRET (env mode) or " +
          "send the X-KPN-Client-Id / X-KPN-Client-Secret gateway headers."
      );
    }
    try {
      client ??= new KpnClient(credentials);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResult(`Invalid KPN credentials: ${message}`);
    }

    return handleToolCall(client, name, (args ?? {}) as Record<string, unknown>, {
      // Resolved per request: the envelope-declared capabilities on
      // 2026-07-28 requests (the SDK backfills the accessor from the
      // validated envelope), the initialize-declared set on 2025-era
      // connections, undefined on the stateless legacy path — where the
      // helpers correctly report elicitation as unavailable.
      clientCapabilities: server.getClientCapabilities(),
      inputResponses: ctx.mcpReq.inputResponses,
    });
  });

  return server;
}
