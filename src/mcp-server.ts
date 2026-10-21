/**
 * Shared MCP server factory for KPN.
 *
 * Side-effect free: importing it never starts a transport. One factory serves
 * both protocol eras. `tools/list` returns the module-scope `TOOLS` array by
 * reference for every caller.
 *
 * Default credentials are Grexx OAuth client_credentials
 * (`KPN_GREXX_USERNAME` / `KPN_GREXX_PASSWORD`). The token mint and Bearer
 * cache live in `@wyre-ai/node-kpn`. Base URL and token URL come from the
 * environment, except that gateway mode may send a per-connection pair,
 * `X-Grexx-Api-Url` + `X-Grexx-Token-Url` (both or neither, WYREAI-525). Those
 * are checked against the Grexx host allowlist here and SSRF-guarded by the
 * SDK on every request. Other URL header names are rejected.
 *
 * developer.kpn.com credentials are resolved only when
 * `KPN_LEGACY_DEVELOPER_API=1`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/server";
import type { McpServerFactory } from "@modelcontextprotocol/server";
import { GrexxClient, GrexxConfigError, assertGrexxAllowedUrl } from "@wyre-ai/node-kpn";
import { KpnClient } from "@wyre-ai/node-kpn/legacy";
import { handleToolCall, type ToolClients } from "./handlers/index.js";
import { errorResult } from "./handlers/results.js";
import { LEGACY_DEVELOPER_API_ENABLED, TOOLS } from "./tools/index.js";
import { logger } from "./utils/logger.js";

export const SERVER_NAME = "kpn-mcp";
/** Protocol identity for MCP initialize. `/health` reports {@link packageVersion} instead. */
export const SERVER_VERSION = "1.0.0";

/** `package.json` version, read from the package root next to `src/` or `dist/`. */
export function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const parsed = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version;
  return SERVER_VERSION;
}

export { LEGACY_DEVELOPER_API_ENABLED };

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

export interface GrexxCredentials {
  /** OAuth client_id. `KPN_GREXX_USERNAME` or `X-KPN-Grexx-Username`. */
  username: string;
  /** OAuth client_secret. `KPN_GREXX_PASSWORD` or `X-KPN-Grexx-Password`. */
  password: string;
  /** `X-Grexx-Api-Url` (gateway, per connection) or `KPN_GREXX_BASE_URL`. */
  baseUrl?: string;
  /** `X-Grexx-Token-Url` (gateway, per connection) or `KPN_GREXX_TOKEN_URL`. SDK default is acceptatie. */
  tokenUrl?: string;
  /**
   * True when both URLs came from `X-Grexx-Api-Url` / `X-Grexx-Token-Url`.
   * Turns on the SDK's host allowlist + DNS SSRF guard for every request.
   */
  perConnectionUrls?: boolean;
}

export interface ResolvedCredentials {
  grexx?: GrexxCredentials;
  legacy?: KpnCredentials;
  /** Grexx username/password missing or only half-present. */
  grexxError?: string;
  /** Legacy headers or env vars were sent as an incomplete pair. */
  legacyError?: string;
  /** Caller supplied a forbidden URL header, a lone or invalid X-Grexx-*-Url header. */
  rejectedUrl?: boolean;
  rejectedUrlError?: string;
}

/** Per-connection Grexx URL headers (both or neither). */
export const GREXX_URL_HEADERS = ["X-Grexx-Api-Url", "X-Grexx-Token-Url"] as const;

/** Gateway credential headers, plus the optional per-connection URL pair. */
export const GREXX_GATEWAY_HEADERS = [
  "X-KPN-Grexx-Username",
  "X-KPN-Grexx-Password",
  ...GREXX_URL_HEADERS,
] as const;

/** Legacy developer.kpn.com headers. Honoured only when the legacy flag is on. */
export const LEGACY_GATEWAY_HEADERS = [
  "X-KPN-Client-Id",
  "X-KPN-Client-Secret",
  "X-KPN-MSM-Client-Id",
  "X-KPN-MSM-Client-Secret",
] as const;

/** Headers advertised on CORS. Grexx always; legacy only when that surface is on. */
export const GATEWAY_HEADERS = LEGACY_DEVELOPER_API_ENABLED
  ? [...GREXX_GATEWAY_HEADERS, ...LEGACY_GATEWAY_HEADERS]
  : [...GREXX_GATEWAY_HEADERS];

/** The headers every gateway request must carry. */
export const REQUIRED_GATEWAY_HEADERS = ["X-KPN-Grexx-Username", "X-KPN-Grexx-Password"] as const;

/**
 * Same set `@wyre-ai/node-kpn` rejects in `resolveGrexxConfig`. A non-empty
 * value fails the request before a client is built, so the secret is never
 * posted to a caller-chosen host.
 */
const REJECTED_URL_HEADERS = [
  "x-kpn-grexx-base-url",
  "x-kpn-grexx-token-url",
  "x-kpn-grexx-baseurl",
  "x-kpn-grexx-tokenurl",
  "x-kpn-base-url",
  "x-kpn-token-url",
] as const;

export type HeaderLookup = (lowerName: string) => string | string[] | undefined | null;

export interface ResolveOptions {
  /** Defaults to the process-start flag. */
  legacyEnabled?: boolean;
  /** Defaults to `process.env`. Used for base URL and token URL, never for gateway secrets. */
  env?: Record<string, string | undefined>;
}

/** Trim a credential or URL value, treating missing and whitespace-only values as absent. */
function blankToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Normalize a header value, using only the first value when Node supplies an array. */
function headerText(value: string | string[] | undefined | null): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value ?? undefined;
  return blankToUndefined(raw ?? undefined);
}

/** Return the first forbidden URL header with a non-empty value, if any. */
function rejectedUrl(getHeader: HeaderLookup): string | undefined {
  for (const name of REJECTED_URL_HEADERS) {
    if (headerText(getHeader(name))) return name;
  }
  return undefined;
}

/** Build a credential-resolution failure that instructs callers to configure URLs in the environment. */
function urlRejection(headerName: string): ResolvedCredentials {
  return {
    rejectedUrl: true,
    rejectedUrlError:
      `Refusing caller-supplied Grexx URL from header "${headerName}". ` +
      "Use X-Grexx-Api-Url and X-Grexx-Token-Url, or set KPN_GREXX_BASE_URL and KPN_GREXX_TOKEN_URL in the environment.",
  };
}

/**
 * Read the optional per-connection URL pair. Both absent/empty: `{}` (env
 * fallback). Exactly one, or a value that fails the allowlist checks: a 400
 * rejection whose message never echoes the URL.
 */
function perConnectionUrls(
  getHeader: HeaderLookup
): { urls?: { baseUrl: string; tokenUrl: string }; rejection?: ResolvedCredentials } {
  const apiUrl = headerText(getHeader("x-grexx-api-url"));
  const tokenUrl = headerText(getHeader("x-grexx-token-url"));
  if (!apiUrl && !tokenUrl) return {};
  const reject = (message: string) => ({ rejection: { rejectedUrl: true, rejectedUrlError: message } });
  if (!apiUrl || !tokenUrl) {
    return reject(
      "X-Grexx-Api-Url and X-Grexx-Token-Url must be provided together " +
        "(or both omitted for the environment default)."
    );
  }
  try {
    assertGrexxAllowedUrl(apiUrl, "X-Grexx-Api-Url", "api");
    assertGrexxAllowedUrl(tokenUrl, "X-Grexx-Token-Url", "token");
  } catch (error) {
    return reject(error instanceof Error ? error.message : "Invalid Grexx URL header.");
  }
  return { urls: { baseUrl: apiUrl, tokenUrl } };
}

/**
 * Build validated legacy credentials. Empty strings count as absent.
 * Returns `{ creds }` or `{ error }`. A half MSM pair is an error. Both
 * missing is "absent", not an error — the caller decides whether absence is fatal.
 */
export function buildLegacyCredentials(
  clientId: string | undefined,
  clientSecret: string | undefined,
  msmClientId?: string,
  msmClientSecret?: string
): { creds?: KpnCredentials; error?: string; absent?: boolean } {
  const id = blankToUndefined(clientId);
  const secret = blankToUndefined(clientSecret);
  const msmId = blankToUndefined(msmClientId);
  const msmSecret = blankToUndefined(msmClientSecret);
  if (!id && !secret && !msmId && !msmSecret) return { absent: true };
  const missing: string[] = [];
  if (!id) missing.push("X-KPN-Client-Id");
  if (!secret) missing.push("X-KPN-Client-Secret");
  if (missing.length > 0) {
    return {
      error:
        `Missing credentials: ${missing.join(", ")} ` +
        "(or KPN_CLIENT_ID / KPN_CLIENT_SECRET in env mode)",
    };
  }
  if (Boolean(msmId) !== Boolean(msmSecret)) {
    return {
      error:
        "Incomplete MSM credentials: send both X-KPN-MSM-Client-Id and " +
        "X-KPN-MSM-Client-Secret, or neither (KPN_MSM_CLIENT_ID / KPN_MSM_CLIENT_SECRET " +
        "in env mode)",
    };
  }
  const creds: KpnCredentials = { clientId: id as string, clientSecret: secret as string };
  if (msmId && msmSecret) {
    creds.msmClientId = msmId;
    creds.msmClientSecret = msmSecret;
  }
  return { creds };
}

/** @deprecated Use {@link buildLegacyCredentials}. Kept for the legacy pair's call shape. */
export const buildCredentials = buildLegacyCredentials;

/** Combine the supplied OAuth credentials with optional URLs read only from the environment. */
function attachGrexxUrls(
  username: string,
  password: string,
  env: Record<string, string | undefined>
): GrexxCredentials {
  const creds: GrexxCredentials = { username, password };
  const baseUrl = blankToUndefined(env.KPN_GREXX_BASE_URL);
  const tokenUrl = blankToUndefined(env.KPN_GREXX_TOKEN_URL);
  if (baseUrl) creds.baseUrl = baseUrl;
  if (tokenUrl) creds.tokenUrl = tokenUrl;
  return creds;
}

/** Describe missing gateway credentials and name their env-mode equivalents. */
function missingGrexxHeaders(missing: string[]): string {
  return (
    `Missing credentials: ${missing.join(", ")} ` +
    "(or KPN_GREXX_USERNAME / KPN_GREXX_PASSWORD in env mode)"
  );
}

/** Describe the missing Grexx environment credential variables. */
function missingGrexxEnv(missing: string[]): string {
  return `Missing Grexx credentials: ${missing.join(" and ")} are required.`;
}

/** Validate optional legacy credentials and attach the configured base URL when credentials exist. */
function resolveLegacy(
  clientId: string | undefined,
  clientSecret: string | undefined,
  msmClientId: string | undefined,
  msmClientSecret: string | undefined,
  baseUrl: string | undefined
): Pick<ResolvedCredentials, "legacy" | "legacyError"> {
  const built = buildLegacyCredentials(clientId, clientSecret, msmClientId, msmClientSecret);
  if (built.error) return { legacyError: built.error };
  if (!built.creds) return {};
  if (baseUrl) built.creds.baseUrl = baseUrl;
  return { legacy: built.creds };
}

/**
 * Gateway credentials. Username and password come from headers only — never
 * from the environment. Base URL and token URL come from `X-Grexx-Api-Url` +
 * `X-Grexx-Token-Url` when both are sent (allowlisted, SSRF-guarded), otherwise
 * from the environment. A lone URL header, an invalid one, or any other URL
 * header name rejects the whole request.
 */
export function resolveGatewayCredentials(
  getHeader: HeaderLookup,
  options: ResolveOptions = {}
): ResolvedCredentials {
  const blocked = rejectedUrl(getHeader);
  if (blocked) return urlRejection(blocked);
  const perConnection = perConnectionUrls(getHeader);
  if (perConnection.rejection) return perConnection.rejection;

  const env = options.env ?? process.env;
  const legacyEnabled = options.legacyEnabled ?? LEGACY_DEVELOPER_API_ENABLED;
  const username = headerText(getHeader("x-kpn-grexx-username"));
  const password = headerText(getHeader("x-kpn-grexx-password"));
  const missing: string[] = [];
  if (!username) missing.push("X-KPN-Grexx-Username");
  if (!password) missing.push("X-KPN-Grexx-Password");

  const resolved: ResolvedCredentials = {};
  if (missing.length > 0) resolved.grexxError = missingGrexxHeaders(missing);
  else if (perConnection.urls) {
    resolved.grexx = {
      username: username as string,
      password: password as string,
      ...perConnection.urls,
      perConnectionUrls: true,
    };
  } else resolved.grexx = attachGrexxUrls(username as string, password as string, env);

  if (legacyEnabled) {
    const legacy = resolveLegacy(
      headerText(getHeader("x-kpn-client-id")),
      headerText(getHeader("x-kpn-client-secret")),
      headerText(getHeader("x-kpn-msm-client-id")),
      headerText(getHeader("x-kpn-msm-client-secret")),
      blankToUndefined(env.KPN_BASE_URL)
    );
    if (legacy.legacy) resolved.legacy = legacy.legacy;
    if (legacy.legacyError) resolved.legacyError = legacy.legacyError;
  }
  return resolved;
}

/** Env-mode credentials. Does not read request headers. */
export function resolveEnvCredentials(
  env: Record<string, string | undefined> = process.env,
  options: { legacyEnabled?: boolean } = {}
): ResolvedCredentials {
  const legacyEnabled = options.legacyEnabled ?? LEGACY_DEVELOPER_API_ENABLED;
  const username = blankToUndefined(env.KPN_GREXX_USERNAME);
  const password = blankToUndefined(env.KPN_GREXX_PASSWORD);
  const missing: string[] = [];
  if (!username) missing.push("KPN_GREXX_USERNAME");
  if (!password) missing.push("KPN_GREXX_PASSWORD");

  const resolved: ResolvedCredentials = {};
  if (missing.length > 0) resolved.grexxError = missingGrexxEnv(missing);
  else resolved.grexx = attachGrexxUrls(username as string, password as string, env);

  if (legacyEnabled) {
    const legacy = resolveLegacy(
      env.KPN_CLIENT_ID,
      env.KPN_CLIENT_SECRET,
      env.KPN_MSM_CLIENT_ID,
      env.KPN_MSM_CLIENT_SECRET,
      blankToUndefined(env.KPN_BASE_URL)
    );
    if (legacy.legacy) resolved.legacy = legacy.legacy;
    if (legacy.legacyError) resolved.legacyError = legacy.legacyError;
  }
  return resolved;
}

/**
 * Bind createMcpServer into the McpServerFactory shape. The factory runs once
 * per HTTP request. In gateway mode, headers come from ctx.requestInfo.
 * Missing headers are answered 401 by the HTTP layer before serving starts.
 * The factory itself never throws.
 */
export function makeMcpServerFactory(options: { gatewayMode: boolean }): McpServerFactory {
  return (ctx) => {
    if (options.gatewayMode) {
      return createMcpServer(
        resolveGatewayCredentials((name) => ctx.requestInfo?.headers.get(name) ?? undefined)
      );
    }
    return createMcpServer(resolveEnvCredentials());
  };
}

/** Return the active tool catalog by reference, preserving its fixed order for every caller. */
export function listToolsResult(): { tools: typeof TOOLS } {
  return { tools: TOOLS };
}

/** Construct the OAuth client, rejecting missing base URLs before delegating validation to the SDK. */
function grexxClient(creds: GrexxCredentials): GrexxClient {
  if (!creds.baseUrl) {
    throw new GrexxConfigError(
      "KPN_GREXX_BASE_URL is required and must be a non-empty https URL " +
        "(or send X-Grexx-Api-Url and X-Grexx-Token-Url per connection)."
    );
  }
  return new GrexxClient({
    username: creds.username,
    password: creds.password,
    baseUrl: creds.baseUrl,
    ...(creds.tokenUrl ? { tokenUrl: creds.tokenUrl } : {}),
    ...(creds.perConnectionUrls ? { ssrfGuard: true } : {}),
  });
}

/**
 * Fresh MCP server. Credentials may be absent: `tools/list` still serves the
 * full deterministic surface; `tools/call` answers isError instead of throwing.
 */
export function createMcpServer(credentials?: ResolvedCredentials): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  // Built lazily on the first tools/call. The SDK caches OAuth tokens
  // process-wide, so a fresh GrexxClient per HTTP request does not mint a
  // token per tool call. This server does not mint the Grexx token. Requests
  // kpn-mcp builds do not post client credentials in a form body. GrexxClient
  // sends HTTP Basic to the token endpoint first and may fall back to form-body
  // client_id/client_secret after HTTP 400/401 invalid_client, then Bearer on
  // POST /realtime.
  let grexx: GrexxClient | undefined;
  let legacy: KpnClient | undefined;

  server.setRequestHandler("tools/list", async () => listToolsResult());

  server.setRequestHandler("tools/call", async (request, ctx) => {
    const { name, arguments: args } = request.params;
    logger.debug("Tool call received", { tool: name });
    const toolName = typeof name === "string" ? name : "";
    const grexxTool = toolName.startsWith("kpn_grexx_");

    if (grexxTool && !credentials?.grexx) {
      return errorResult(
        credentials?.grexxError ??
          "Missing Grexx credentials. Set KPN_GREXX_USERNAME and KPN_GREXX_PASSWORD (env mode) or " +
            "send X-KPN-Grexx-Username and X-KPN-Grexx-Password."
      );
    }
    if (!grexxTool && LEGACY_DEVELOPER_API_ENABLED && !credentials?.legacy && credentials?.legacyError) {
      return errorResult(credentials.legacyError);
    }

    const clients: ToolClients = {};
    if (credentials?.grexx) {
      try {
        grexx ??= grexxClient(credentials.grexx);
        clients.grexx = grexx;
      } catch (error) {
        if (grexxTool) {
          const message = error instanceof Error ? error.message : String(error);
          return errorResult(`Invalid Grexx configuration: ${message}`);
        }
        // A legacy tool does not need a Grexx client.
      }
    }
    if (credentials?.legacy) {
      try {
        legacy ??= new KpnClient(credentials.legacy);
        clients.legacy = legacy;
      } catch (error) {
        if (!grexxTool) {
          const message = error instanceof Error ? error.message : String(error);
          return errorResult(`Invalid KPN credentials: ${message}`);
        }
      }
    }

    return handleToolCall(clients, name, (args ?? {}) as Record<string, unknown>, {
      clientCapabilities: server.getClientCapabilities(),
      inputResponses: ctx.mcpReq.inputResponses,
    });
  });

  return server;
}
