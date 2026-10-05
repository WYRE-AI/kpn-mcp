/**
 * tools/call dispatch. Errors become isError results and never escape
 * to the transport. Phase 1 tools are reads; elicitation is threaded
 * through for a later Proxymodule write phase and is unused here.
 */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import {
  GrexxError,
  GrexxRateLimitError,
  type KpnGrexxClient,
} from "@wyre-ai/node-kpn";
import { NO_ELICITATION, type ElicitationContext } from "../elicitation.js";
import { TOOLS } from "../tools/index.js";
import { GREXX_HANDLERS } from "./grexx.js";
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

const HANDLERS = mergeHandlers([GREXX_HANDLERS]);

for (const tool of TOOLS) {
  if (!Object.hasOwn(HANDLERS, tool.name)) {
    throw new Error(`Tool "${tool.name}" has no handler.`);
  }
}

/** Built only from the parsed Grexx error. Never includes response XML or credentials. */
export function describeGrexxError(error: GrexxError): string {
  const http = error.httpStatus !== undefined ? `HTTP ${error.httpStatus}` : "Grexx";
  const code = error.grexxCode !== undefined ? `, code ${error.grexxCode}` : "";
  let text = `Grexx error (${http}${code}): ${error.message}`;
  if (error instanceof GrexxRateLimitError && error.retryAfterSeconds !== undefined) {
    text += ` Retry after ${error.retryAfterSeconds}s.`;
  }
  if (error.grexxCode === 102) {
    text += " Check the API username, password, and IP allowlist.";
  }
  return text;
}

export async function handleToolCall(
  client: KpnGrexxClient,
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
    if (error instanceof GrexxError) {
      return errorResult(describeGrexxError(error));
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Error calling ${name}: ${message}`);
  }
}
