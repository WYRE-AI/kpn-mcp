/**
 * The complete KPN tool surface — 23 tools, FLAT (no router).
 *
 * Deterministic ordering rule: `TOOLS` is one module-scope array in the exact
 * order of design.md §4.3, assembled from the domain modules below.
 * `tools/list` returns this array by reference for every request, every era,
 * every caller. Never sorted at runtime, never filtered per-session, never
 * varied by credentials.
 *
 * Hand-written JSON Schema (no zod). Destructive (D) and sensitive-read (S)
 * tools follow fleet convention §2.7b: a "⚠ DESTRUCTIVE" / "⚠ HIGH-IMPACT"
 * description prefix, inline annotations, CONFIRM_ARG_PROPERTY in the schema,
 * and a description ending "Confirm with the user before invoking."
 */
import type { Tool } from "@modelcontextprotocol/server";
import { CORE_TOOLS } from "./core.js";
import { MOBILE_READ_TOOLS } from "./mobile-read.js";
import { MOBILE_WRITE_TOOLS } from "./mobile-write.js";
import { NETWORK_TOOLS } from "./network.js";

export const TOOLS: Tool[] = [
  ...CORE_TOOLS, // 1
  ...NETWORK_TOOLS, // 2–4
  ...MOBILE_READ_TOOLS, // 5–18
  ...MOBILE_WRITE_TOOLS, // 19–23
];

export const TOOL_NAMES = TOOLS.map((tool) => tool.name);
