/**
 * Shared MCP server factory. Side-effect free. One factory serves both
 * protocol eras. `tools/list` returns the module-scope TOOLS array by
 * reference for every caller.
 */
import { Server } from "@modelcontextprotocol/server";
import type { McpServerFactory } from "@modelcontextprotocol/server";
import { KpnGrexxClient, type AuthMode } from "@wyre-ai/node-kpn";
import { handleToolCall } from "./handlers/index.js";
import { errorResult } from "./handlers/results.js";
import { TOOLS } from "./tools/index.js";
import { logger } from "./utils/logger.js";

export const SERVER_NAME = "kpn-mcp";
export const SERVER_VERSION = "2.0.0";

export interface GrexxCredentials {
  username: string;
  password: string;
  /**
   * Env only. Never taken from a gateway header: a caller-chosen base URL
   * would send the API password to an arbitrary host.
   */
  baseUrl?: string;
  authMode?: AuthMode;
  tokenUrl?: string;
  scope?: string;
}

/** Gateway header names. Node lowercases them on receipt. */
export const GATEWAY_HEADERS = ["X-KPN-Grexx-Username", "X-KPN-Grexx-Password"] as const;

export const REQUIRED_GATEWAY_HEADERS = ["X-KPN-Grexx-Username", "X-KPN-Grexx-Password"] as const;

interface ServerOptions {
  baseUrl?: string;
  authMode?: AuthMode;
  tokenUrl?: string;
  scope?: string;
}

function blankToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Env-only server options. Ignores any header that might try to set the base URL. */
export function readServerOptions(
  env: Record<string, string | undefined> = process.env
): { options: ServerOptions; error?: string } {
  const authRaw = env.KPN_GREXX_AUTH_MODE?.trim();
  let authMode: AuthMode | undefined;
  if (authRaw) {
    if (authRaw !== "oauth" && authRaw !== "basic") {
      return { options: {}, error: 'KPN_GREXX_AUTH_MODE must be "oauth" or "basic".' };
    }
    authMode = authRaw;
  }
  return {
    options: {
      baseUrl: blankToUndefined(env.KPN_GREXX_BASE_URL),
      authMode,
      tokenUrl: blankToUndefined(env.KPN_GREXX_TOKEN_URL),
      scope: blankToUndefined(env.KPN_GREXX_SCOPE),
    },
  };
}

export function buildCredentials(
  username: string | undefined,
  password: string | undefined,
  server: ServerOptions = {}
): { creds?: GrexxCredentials; error?: string } {
  const user = blankToUndefined(username);
  const pass = typeof password === "string" && password.trim() !== "" ? password : undefined;
  const missing: string[] = [];
  if (!user) missing.push("X-KPN-Grexx-Username");
  if (!pass) missing.push("X-KPN-Grexx-Password");
  if (missing.length > 0) {
    return {
      error:
        `Missing credentials: ${missing.join(", ")} ` +
        "(or KPN_GREXX_USERNAME / KPN_GREXX_PASSWORD in env mode)",
    };
  }
  return {
    creds: {
      username: user as string,
      password: pass as string,
      ...server,
    },
  };
}

/** Per-request gateway credentials. Base URL stays on the environment. */
export function resolveGatewayCredentials(
  getHeader: (lowerName: string) => string | undefined,
  env: Record<string, string | undefined> = process.env
): { creds?: GrexxCredentials; error?: string } {
  const server = readServerOptions(env);
  if (server.error) return { error: server.error };
  return buildCredentials(
    getHeader("x-kpn-grexx-username"),
    getHeader("x-kpn-grexx-password"),
    server.options
  );
}

export function resolveEnvCredentials(
  env: Record<string, string | undefined> = process.env
): { creds?: GrexxCredentials; error?: string } {
  const server = readServerOptions(env);
  if (server.error) return { error: server.error };
  return buildCredentials(env.KPN_GREXX_USERNAME, env.KPN_GREXX_PASSWORD, server.options);
}

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

export function listToolsResult(): { tools: typeof TOOLS } {
  return { tools: TOOLS };
}

function clientFrom(credentials: GrexxCredentials): KpnGrexxClient {
  if (!credentials.baseUrl) {
    throw new Error(
      "KPN_GREXX_BASE_URL is required (environment only; gateway headers cannot set it)."
    );
  }
  return new KpnGrexxClient({
    username: credentials.username,
    password: credentials.password,
    baseUrl: credentials.baseUrl,
    authMode: credentials.authMode,
    tokenUrl: credentials.tokenUrl,
    scope: credentials.scope,
  });
}

export function createMcpServer(credentials?: GrexxCredentials): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  let client: KpnGrexxClient | undefined;

  server.setRequestHandler("tools/list", async () => listToolsResult());

  server.setRequestHandler("tools/call", async (request, ctx) => {
    const { name, arguments: args } = request.params;
    logger.debug("Tool call received", { tool: name });

    if (!credentials) {
      return errorResult(
        "Missing Grexx credentials. Set KPN_GREXX_USERNAME and KPN_GREXX_PASSWORD (env mode) or " +
          "send the X-KPN-Grexx-Username / X-KPN-Grexx-Password gateway headers."
      );
    }
    try {
      client ??= clientFrom(credentials);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResult(`Invalid Grexx configuration: ${message}`);
    }

    return handleToolCall(client, name, (args ?? {}) as Record<string, unknown>, {
      clientCapabilities: server.getClientCapabilities(),
      inputResponses: ctx.mcpReq.inputResponses,
    });
  });

  return server;
}
