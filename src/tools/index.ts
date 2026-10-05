/**
 * Phase 1 Grexx tool surface — 15 realtime tools, flat (no router).
 *
 * `TOOLS` is one module-scope array in MCP-TOOL-PROPOSAL order. `tools/list`
 * returns this array by reference for every request, every era, every caller.
 * Never sorted at runtime, never filtered per session, never varied by
 * credentials.
 *
 * Queued calls, OrderModule and inbound notifications are absent on purpose.
 * The partner portal has no Proxymodule rights, so those results never arrive.
 * Do not register them until a receiver exists.
 */
import type { Tool } from "@modelcontextprotocol/server";
import { CONNECTIVITY_TOOLS } from "./connectivity.js";
import { GENERIC_TOOLS } from "./generic.js";
import { MOBILE_TOOLS } from "./mobile.js";

export const TOOLS: Tool[] = [
  ...GENERIC_TOOLS.slice(0, 1), // 1 test_connection
  ...CONNECTIVITY_TOOLS.slice(0, 4), // 2–5 zipcode, prequalification, carrier, radius
  ...GENERIC_TOOLS.slice(1, 2), // 6 ras_check
  ...CONNECTIVITY_TOOLS.slice(4), // 7 start_line_diagnose
  ...GENERIC_TOOLS.slice(2), // 8–10 customer, order summary, order data
  ...MOBILE_TOOLS, // 11–15
];

export const TOOL_NAMES = TOOLS.map((tool) => tool.name);
