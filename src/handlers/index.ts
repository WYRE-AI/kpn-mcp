/**
 * tools/call dispatch. The SDK client is bound per request by the caller
 * (mcp-server.ts); this module maps tool names to handlers and normalizes
 * every failure into an isError text result — errors are never thrown out.
 *
 * The handler map is merged from the domain modules. A duplicate name, or a
 * tool in TOOLS without a handler, throws at module load so a wiring mistake
 * fails every test instead of surfacing as "Unknown tool" in production.
 */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import {
  AuthenticationError,
  ForbiddenError,
  KpnError,
  RateLimitError,
  ServerError,
  type KpnClient,
} from "@wyre-technology/node-kpn";
import { NO_ELICITATION, type ElicitationContext } from "../elicitation.js";
import { TOOLS } from "../tools/index.js";
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

const HANDLERS = mergeHandlers([
  CORE_HANDLERS,
  NETWORK_HANDLERS,
  MOBILE_READ_HANDLERS,
  MOBILE_WRITE_HANDLERS,
]);

for (const tool of TOOLS) {
  if (!Object.hasOwn(HANDLERS, tool.name)) {
    throw new Error(`Tool "${tool.name}" has no handler.`);
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

export async function handleToolCall(
  client: KpnClient,
  name: string,
  args: Record<string, unknown>,
  elicitation: ElicitationContext = NO_ELICITATION
): Promise<ToolResult | InputRequiredResult> {
  if (!Object.hasOwn(HANDLERS, name)) {
    return errorResult(`Unknown tool: ${name}`);
  }
  try {
    return await HANDLERS[name](client, args, elicitation);
  } catch (error) {
    if (error instanceof ToolInputError) {
      return errorResult(`Invalid arguments for ${name}: ${error.message}`);
    }
    if (error instanceof KpnError) {
      return errorResult(describeKpnError(error, name));
    }
    const message = error instanceof Error ? error.message : String(error);
    const hint = isWriteTool(name) ? ` ${WRITE_RETRY_HINT}` : "";
    return errorResult(`Error calling ${name}: ${message}${hint}`);
  }
}
