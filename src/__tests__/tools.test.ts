/** Phase 1 tool-surface contract: exactly the 15 realtime kpn_grexx_* tools. */
import { describe, expect, it } from "vitest";
import { listToolsResult } from "../mcp-server.js";
import { TOOLS, TOOL_NAMES } from "../tools/index.js";

const EXPECTED_ORDER = [
  "kpn_grexx_test_connection",
  "kpn_grexx_zipcode_check",
  "kpn_grexx_prequalification",
  "kpn_grexx_carrier_info",
  "kpn_grexx_radius_check",
  "kpn_grexx_ras_check",
  "kpn_grexx_start_line_diagnose",
  "kpn_grexx_customer_data",
  "kpn_grexx_order_summary",
  "kpn_grexx_order_data",
  "kpn_grexx_get_sim",
  "kpn_grexx_mobile_settings",
  "kpn_grexx_mobile_usage",
  "kpn_grexx_mobile_orders",
  "kpn_grexx_available_portings",
];

describe("tool surface", () => {
  it("has exactly 15 kpn_grexx_* tools in proposal order", () => {
    expect(TOOLS).toHaveLength(15);
    expect(TOOL_NAMES).toEqual(EXPECTED_ORDER);
    for (const name of TOOL_NAMES) expect(name).toMatch(/^kpn_grexx_[a-z_]+$/);
  });

  it("returns the same TOOLS reference on each listToolsResult() call", () => {
    expect(listToolsResult().tools).toBe(TOOLS);
  });

  it("every tool is a read with an object schema and no destructive confirm", () => {
    for (const tool of TOOLS) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBeUndefined();
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      expect(properties.confirm_destructive_action, tool.name).toBeUndefined();
    }
  });

  it("get_sim takes an integer orderId and does not mention GetSimCard", () => {
    const tool = TOOLS.find((item) => item.name === "kpn_grexx_get_sim");
    const schema = tool?.inputSchema as {
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    expect(schema.properties?.orderId?.type).toBe("integer");
    expect(schema.required).toEqual(["orderId"]);
    expect(tool?.description).not.toMatch(/GetSimCardRequest/);
    expect(tool?.description).toContain("GetSimRequest_V1");
  });
});
