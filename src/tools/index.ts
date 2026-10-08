/**
 * Tool surface.
 *
 * Default (Grexx-first): `GREXX_TOOLS`, fixed order, one module-scope array.
 * `KPN_LEGACY_DEVELOPER_API=1` appends the developer.kpn.com catalog
 * (`LEGACY_TOOLS`) after the Grexx tools. The flag is read once, when this
 * module loads, so `tools/list` is the same reference for every request.
 *
 * `tools/list` returns `TOOLS` by reference. Never sort, filter, or rebuild it.
 */
import type { Tool } from "@modelcontextprotocol/server";
import { CORE_TOOLS } from "./core.js";
import { GREXX_TOOLS } from "./grexx.js";
import { MOBILE_READ_TOOLS } from "./mobile-read.js";
import { MOBILE_WRITE_TOOLS } from "./mobile-write.js";
import { NETWORK_TOOLS } from "./network.js";

/** developer.kpn.com tools, design.md §4.3 order. Off unless the legacy flag is set. */
export const LEGACY_TOOLS: Tool[] = [
  ...CORE_TOOLS,
  ...NETWORK_TOOLS,
  ...MOBILE_READ_TOOLS,
  ...MOBILE_WRITE_TOOLS,
];

/** Grexx tools, then the legacy catalog. Used only when the legacy flag is on. */
export const ALL_TOOLS: Tool[] = [...GREXX_TOOLS, ...LEGACY_TOOLS];

/**
 * Process-start switch. `1` appends developer.kpn.com tools. Any other value,
 * including unset, serves Grexx only.
 */
export const LEGACY_DEVELOPER_API_ENABLED = process.env.KPN_LEGACY_DEVELOPER_API === "1";

export const TOOLS: Tool[] = LEGACY_DEVELOPER_API_ENABLED ? ALL_TOOLS : GREXX_TOOLS;

export const TOOL_NAMES = TOOLS.map((tool) => tool.name);

export { GREXX_TOOLS };
