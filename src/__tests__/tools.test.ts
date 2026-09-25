/** Tool-surface contract tests: count, names, order, schemas, warnings, annotations. */
import { describe, expect, it } from "vitest";
import { CONFIRM_ARG } from "../elicitation.js";
import { listToolsResult } from "../mcp-server.js";
import { TOOLS, TOOL_NAMES } from "../tools/index.js";

/** design.md §4.3 order — the single source of truth for the surface. */
const EXPECTED_ORDER = [
  "kpn_test_connection",
  "kpn_disturbances_check",
  "kpn_availability_check",
  "kpn_sim_swap_get_date",
  "kpn_mobile_subscribers_list",
  "kpn_mobile_subscribers_get",
  "kpn_mobile_contracts_list",
  "kpn_mobile_contracts_get",
  "kpn_mobile_contracts_get_puk",
  "kpn_mobile_contracts_get_operations",
  "kpn_mobile_orders_list",
  "kpn_mobile_orders_get",
  "kpn_mobile_service_requests_list",
  "kpn_mobile_service_requests_get",
  "kpn_mobile_invoices_list",
  "kpn_mobile_invoices_get_pdf",
  "kpn_mobile_hierarchy_list",
  "kpn_mobile_thresholds_list",
  "kpn_mobile_sim_block",
  "kpn_mobile_sim_unblock",
  "kpn_mobile_sim_replace",
  "kpn_mobile_orders_authorize",
  "kpn_mobile_orders_cancel",
];

/** Tier D (destructive / high-impact writes) with their exact description prefix. */
const TIER_D: Record<string, string> = {
  kpn_mobile_sim_block: "⚠ HIGH-IMPACT.",
  kpn_mobile_sim_unblock: "⚠ HIGH-IMPACT.",
  kpn_mobile_sim_replace: "⚠ DESTRUCTIVE.",
  kpn_mobile_orders_authorize: "⚠ HIGH-IMPACT.",
  kpn_mobile_orders_cancel: "⚠ DESTRUCTIVE.",
};

/** Tier S (sensitive reads): gated like D, but annotated read-only. */
const TIER_S: Record<string, string> = {
  kpn_mobile_contracts_get_puk: "⚠ HIGH-IMPACT.",
};

const GATED = { ...TIER_D, ...TIER_S };

function tool(name: string) {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

function schemaOf(name: string) {
  return tool(name).inputSchema as {
    properties?: Record<string, { type?: string }>;
    required?: string[];
  };
}

describe("tool surface", () => {
  it("has exactly 23 tools in the design.md order", () => {
    expect(TOOLS).toHaveLength(23);
    expect(TOOL_NAMES).toEqual(EXPECTED_ORDER);
  });

  it("every name matches ^kpn_[a-z_]+$", () => {
    for (const name of TOOL_NAMES) expect(name).toMatch(/^kpn_[a-z_]+$/);
  });

  it("returns the same TOOLS reference on each listToolsResult() call", () => {
    expect(listToolsResult().tools).toBe(TOOLS);
    expect(listToolsResult().tools).toBe(listToolsResult().tools);
  });

  it("every tool has a description and an object inputSchema", () => {
    for (const t of TOOLS) {
      expect(t.description, t.name).toBeTruthy();
      expect(t.inputSchema.type, t.name).toBe("object");
    }
  });

  it("D and S tools carry the exact prefix and the confirm suffix", () => {
    for (const [name, prefix] of Object.entries(GATED)) {
      expect(tool(name).description!.startsWith(prefix), name).toBe(true);
      expect(tool(name).description, name).toMatch(/Confirm with the user before invoking\.$/u);
    }
  });

  it("D and S tools declare the optional non-interactive confirmation argument", () => {
    for (const name of Object.keys(GATED)) {
      const schema = schemaOf(name);
      // Without this the fail-closed gate would be unsatisfiable: a gateway
      // caller cannot pass an argument the schema never advertises.
      expect(schema.properties?.[CONFIRM_ARG]?.type, name).toBe("boolean");
      // Optional on purpose — interactive clients confirm by prompt instead.
      expect(schema.required ?? [], name).not.toContain(CONFIRM_ARG);
    }
  });

  it("D tools carry the destructive annotations", () => {
    for (const name of Object.keys(TIER_D)) {
      expect(tool(name).annotations, name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      });
    }
  });

  it("S tools are gated but annotated read-only (they change no state)", () => {
    for (const name of Object.keys(TIER_S)) {
      expect(tool(name).annotations?.readOnlyHint, name).toBe(true);
      expect(tool(name).annotations?.destructiveHint, name).not.toBe(true);
    }
  });

  it("R tools are read-only, open-world and carry no warning", () => {
    for (const name of EXPECTED_ORDER.filter((n) => !(n in GATED))) {
      expect(tool(name).annotations, name).toMatchObject({
        readOnlyHint: true,
        openWorldHint: true,
      });
      expect(tool(name).description, name).not.toContain("⚠");
      expect(schemaOf(name).properties?.[CONFIRM_ARG], name).toBeUndefined();
    }
  });

  it("required arguments match the design table", () => {
    const required = (name: string) => [...(schemaOf(name).required ?? [])].sort();
    expect(required("kpn_test_connection")).toEqual([]);
    expect(required("kpn_disturbances_check")).toEqual(["houseNumber", "zipCode"]);
    expect(required("kpn_availability_check")).toEqual(["houseNumber", "zipCode"]);
    expect(required("kpn_sim_swap_get_date")).toEqual(["phoneNumber"]);
    expect(required("kpn_mobile_subscribers_get")).toEqual(["id"]);
    expect(required("kpn_mobile_contracts_get")).toEqual(["id"]);
    expect(required("kpn_mobile_contracts_get_puk")).toEqual(["id"]);
    expect(required("kpn_mobile_contracts_get_operations")).toEqual(["contractId"]);
    expect(required("kpn_mobile_orders_get")).toEqual(["id"]);
    expect(required("kpn_mobile_service_requests_get")).toEqual(["id"]);
    expect(required("kpn_mobile_invoices_get_pdf")).toEqual(["id"]);
    expect(required("kpn_mobile_sim_block")).toEqual(["contractId"]);
    expect(required("kpn_mobile_sim_unblock")).toEqual(["contractId"]);
    expect(required("kpn_mobile_sim_replace")).toEqual(["contractId", "esim"]);
    expect(required("kpn_mobile_orders_authorize")).toEqual(["orderId"]);
    expect(required("kpn_mobile_orders_cancel")).toEqual(["orderId"]);
  });
});
