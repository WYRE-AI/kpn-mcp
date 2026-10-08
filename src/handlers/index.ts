/**
 * tools/call dispatch. Clients are bound per request by mcp-server.ts.
 * Every failure becomes an isError text result — errors are never thrown out.
 *
 * Grexx handlers are always registered. Legacy developer.kpn.com handlers are
 * callable through `handleLegacyToolCall` (unit tests, and the server when
 * `KPN_LEGACY_DEVELOPER_API=1`). `handleToolCall` refuses legacy names when
 * the flag is off, even if a handler exists.
 */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import {
  GrexxAuthenticationError,
  GrexxConfigError,
  GrexxError,
  GrexxForbiddenError,
  GrexxRateLimitError,
  GrexxValidationError,
  type GrexxClient,
} from "@wyre-ai/node-kpn";
import {
  AuthenticationError,
  ForbiddenError,
  KpnError,
  RateLimitError,
  ServerError,
  type KpnClient,
} from "@wyre-ai/node-kpn/legacy";
import { NO_ELICITATION, type ElicitationContext } from "../elicitation.js";
import { LEGACY_DEVELOPER_API_ENABLED, LEGACY_TOOLS, TOOLS } from "../tools/index.js";
import { GREXX_HANDLERS, type GrexxToolHandler } from "./grexx.js";
import { CORE_HANDLERS } from "./core.js";
import { MOBILE_READ_HANDLERS } from "./mobile-read.js";
import { MOBILE_WRITE_HANDLERS } from "./mobile-write.js";
import { NETWORK_HANDLERS } from "./network.js";
import { errorResult, ToolInputError, type ToolHandler, type ToolResult } from "./results.js";

function mergeHandlers(maps: Array<Record<string, ToolHandler>>): Record<string, ToolHandler> {
  const merged: Record<string, ToolHandler> = {};
  for (const map of maps) {
    for (const [name, handler] of Object.entries(map)) {
      if (Object.hasOwn(merged, name)) throw new Error(`Duplicate handler for tool "${name}".`);
      merged[name] = handler;
    }
  }
  return merged;
}

const LEGACY_HANDLERS = mergeHandlers([
  CORE_HANDLERS,
  NETWORK_HANDLERS,
  MOBILE_READ_HANDLERS,
  MOBILE_WRITE_HANDLERS,
]);

for (const tool of TOOLS) {
  const handlers = tool.name.startsWith("kpn_grexx_") ? GREXX_HANDLERS : LEGACY_HANDLERS;
  if (!Object.hasOwn(handlers, tool.name)) {
    throw new Error(`Tool "${tool.name}" has no handler.`);
  }
}
for (const tool of LEGACY_TOOLS) {
  if (!Object.hasOwn(LEGACY_HANDLERS, tool.name)) {
    throw new Error(`Legacy tool "${tool.name}" has no handler.`);
  }
}
for (const name of Object.keys(GREXX_HANDLERS)) {
  if (Object.hasOwn(LEGACY_HANDLERS, name)) {
    throw new Error(`Grexx tool "${name}" collides with a legacy tool.`);
  }
}

const MSM_HINT =
  "MSM requires a customer GRIP-bound MSM app; set X-KPN-MSM-Client-Id/Secret for this customer.";

// MSM order POSTs are never retried (design.md §3.1): a duplicate block or
// authorize is a real-world side effect, so the user decides after checking.
const WRITE_RETRY_HINT =
  "The order may or may not have been created; check kpn_mobile_orders_list before retrying.";

function isWriteTool(name: string): boolean {
  return Object.hasOwn(MOBILE_WRITE_HANDLERS, name);
}

/**
 * `KPN error (HTTP {status}{, code}): {message}` plus the KPN transactionId
 * and tool-specific hints. Built only from the parsed error — never from the
 * request, so credentials and headers cannot leak into a tool result.
 */
export function describeKpnError(error: KpnError, toolName = ""): string {
  const code = error.code ? `, ${error.code}` : "";
  let text = `KPN error (HTTP ${error.statusCode}${code}): ${error.message}`;
  if (error.transactionId) text += ` (transactionId: ${error.transactionId})`;
  if (error instanceof RateLimitError) {
    text += ` Rate limited; retry after ${error.retryAfter}s.`;
    if (error.quota?.resetUtc) text += ` Quota resets at ${error.quota.resetUtc} (UTC).`;
  }
  const isAuthFailure = error instanceof AuthenticationError || error instanceof ForbiddenError;
  if (isAuthFailure && toolName.startsWith("kpn_mobile_")) text += ` ${MSM_HINT}`;
  if (error instanceof ServerError && isWriteTool(toolName)) text += ` ${WRITE_RETRY_HINT}`;
  return text;
}

/**
 * Grexx / IRMA failure text. Does not include request bodies or credentials.
 *
 * Local SDK validation (status 0: invalid_zipcode, invalid_house_number, …)
 * is an argument error. A Grexx HTTP validation response stays a Grexx error.
 */
export function describeGrexxError(error: GrexxError, toolName = ""): string {
  if (error instanceof GrexxValidationError && error.statusCode === 0) {
    const target = toolName ? ` for ${toolName}` : "";
    return `Invalid arguments${target}: ${error.message}`;
  }
  const code = error.code ? `, ${error.code}` : "";
  let text = `Grexx error (HTTP ${error.statusCode}${code}): ${error.message}`;
  if (error.requestId) text += ` (x-request-id: ${error.requestId})`;
  if (error instanceof GrexxRateLimitError) {
    text += ` Rate limited (108 Too Many Requests); retry after ${error.retryAfter}s.`;
  }
  if (error instanceof GrexxAuthenticationError) {
    const where =
      process.env.AUTH_MODE === "gateway"
        ? "X-KPN-Grexx-Username and X-KPN-Grexx-Password"
        : "KPN_GREXX_USERNAME and KPN_GREXX_PASSWORD";
    text += ` Check ${where}. Auth is OAuth client_credentials; Basic Auth is not accepted.`;
  }
  if (error instanceof GrexxForbiddenError && error.code === "102") {
    text += " Grexx rejected the caller IP (code 102).";
  }
  return text;
}

export interface ToolClients {
  grexx?: GrexxClient;
  legacy?: KpnClient;
}

/** Invoke a handler and convert input, configuration, SDK, and unexpected failures to tool errors. */
async function runHandler(
  handler: ToolHandler | GrexxToolHandler,
  client: KpnClient | GrexxClient,
  name: string,
  args: Record<string, unknown>,
  elicitation: ElicitationContext,
  describe: (error: KpnError | GrexxError) => string
): Promise<ToolResult | InputRequiredResult> {
  try {
    return await (handler as ToolHandler)(client as KpnClient, args, elicitation);
  } catch (error) {
    if (error instanceof ToolInputError) {
      return errorResult(`Invalid arguments for ${name}: ${error.message}`);
    }
    if (error instanceof GrexxConfigError) {
      return errorResult(`Invalid Grexx configuration: ${error.message}`);
    }
    if (error instanceof KpnError || error instanceof GrexxError) {
      return errorResult(describe(error));
    }
    const message = error instanceof Error ? error.message : String(error);
    const hint = isWriteTool(name) ? ` ${WRITE_RETRY_HINT}` : "";
    return errorResult(`Error calling ${name}: ${message}${hint}`);
  }
}

/** Always dispatches a developer.kpn.com tool. Used by legacy unit tests and by the server when the flag is on. */
export async function handleLegacyToolCall(
  client: KpnClient,
  name: string,
  args: Record<string, unknown>,
  elicitation: ElicitationContext = NO_ELICITATION
): Promise<ToolResult | InputRequiredResult> {
  if (!Object.hasOwn(LEGACY_HANDLERS, name)) {
    return errorResult(`Unknown tool: ${name}`);
  }
  return runHandler(LEGACY_HANDLERS[name], client, name, args, elicitation, (error) =>
    describeKpnError(error as KpnError, name)
  );
}

/** Always dispatches a Grexx tool. */
export async function handleGrexxToolCall(
  client: GrexxClient,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult | InputRequiredResult> {
  if (!Object.hasOwn(GREXX_HANDLERS, name)) {
    return errorResult(`Unknown tool: ${name}`);
  }
  return runHandler(GREXX_HANDLERS[name], client, name, args, NO_ELICITATION, (error) =>
    describeGrexxError(error as GrexxError, name)
  );
}

/**
 * Dispatch a tool on the active surface. Legacy names are unknown unless
 * `KPN_LEGACY_DEVELOPER_API=1` was set when the process started.
 */
export async function handleToolCall(
  clients: ToolClients,
  name: string,
  args: Record<string, unknown>,
  elicitation: ElicitationContext = NO_ELICITATION
): Promise<ToolResult | InputRequiredResult> {
  if (Object.hasOwn(GREXX_HANDLERS, name)) {
    if (!clients.grexx) {
      return errorResult(
        "Missing Grexx credentials. Set KPN_GREXX_USERNAME and KPN_GREXX_PASSWORD (env mode) or " +
          "send X-KPN-Grexx-Username and X-KPN-Grexx-Password."
      );
    }
    return handleGrexxToolCall(clients.grexx, name, args);
  }
  if (LEGACY_DEVELOPER_API_ENABLED && Object.hasOwn(LEGACY_HANDLERS, name)) {
    if (!clients.legacy) {
      return errorResult(
        "Missing developer.kpn.com credentials. Set KPN_CLIENT_ID and KPN_CLIENT_SECRET " +
          "(env mode) or send X-KPN-Client-Id and X-KPN-Client-Secret. " +
          "These tools are only registered when KPN_LEGACY_DEVELOPER_API=1."
      );
    }
    return handleLegacyToolCall(clients.legacy, name, args, elicitation);
  }
  return errorResult(`Unknown tool: ${name}`);
}
