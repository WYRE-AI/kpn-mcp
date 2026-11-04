/** Tool-surface contract tests: count, names, order, schemas, warnings, annotations. */
import { PREQUALIFICATION_PRODUCT_TYPES, PREQUALIFICATION_SUPPLIERS } from "@wyre-ai/node-kpn";
import { describe, expect, it } from "vitest";
import { CONFIRM_ARG } from "../elicitation.js";
import { listToolsResult } from "../mcp-server.js";
import { GREXX_TOOLS, LEGACY_TOOLS, TOOLS, TOOL_NAMES } from "../tools/index.js";

const GREXX_ORDER = [
  "kpn_grexx_test_connection",
  "kpn_grexx_zipcode_check",
  "kpn_grexx_prequalification",
  "kpn_grexx_order_data",
  "kpn_grexx_carrier_info",
  "kpn_grexx_radius_check",
  "kpn_grexx_ras_check",
  "kpn_grexx_start_line_diagnose",
  "kpn_grexx_customer_data",
  "kpn_grexx_order_summary",
  "kpn_grexx_get_sim",
  "kpn_grexx_mobile_settings",
  "kpn_grexx_mobile_usage",
  "kpn_grexx_mobile_total_usage",
  "kpn_grexx_mobile_orders",
  "kpn_grexx_voip_usage",
  "kpn_grexx_voip_total_usage",
  "kpn_grexx_available_portings",
  "kpn_grexx_invoice_catalog",
  "kpn_grexx_microsoft_subscription_end_date",
  "kpn_grexx_upgrade_info",
  "kpn_grexx_related_products",
  "kpn_grexx_mobile_call_forwardings",
  "kpn_grexx_mobile_preferences",
  "kpn_grexx_mobile_module",
  "kpn_grexx_planned_line",
  "kpn_grexx_hip_number_orders",
  "kpn_grexx_clean_internet_info",
  "kpn_grexx_cloud_tenant",
  "kpn_grexx_microsoft_tenant_exists",
  "kpn_grexx_microsoft_domain_ownership",
  "kpn_grexx_custom_price",
  "kpn_grexx_get_contact",
  "kpn_grexx_search_contacts",
  "kpn_grexx_create_contact",
  "kpn_grexx_update_contact",
  "kpn_grexx_modify_voip_user",
  "kpn_grexx_modify_device_profile",
];
const LEGACY_NAMES = LEGACY_TOOLS.map((tool) => tool.name);

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

/** Find a legacy tool definition for schema assertions, failing when the name is absent. */
function tool(name: string) {
  const found = LEGACY_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

function schemaOf(name: string) {
  return tool(name).inputSchema as {
    properties?: Record<string, { type?: string }>;
    required?: string[];
  };
}

describe("default Grexx surface", () => {
  it("serves the phase-1 Grexx tools in order and nothing from developer.kpn.com", () => {
    expect(TOOLS).toBe(GREXX_TOOLS);
    expect(TOOL_NAMES).toEqual(GREXX_ORDER);
    expect(TOOL_NAMES).not.toContain("kpn_disturbances_check");
    expect(TOOL_NAMES).not.toContain("kpn_mobile_sim_block");
  });

  it("serves a 38-tool default Grexx surface", () => {
    expect(TOOL_NAMES).toHaveLength(38);
  });

  it("returns the same TOOLS reference on each listToolsResult() call", () => {
    expect(listToolsResult().tools).toBe(TOOLS);
    expect(listToolsResult().tools).toBe(listToolsResult().tools);
  });

  it("serves valid Grexx tool schemas and tier annotations", () => {
    for (const t of GREXX_TOOLS) {
      expect(t.name).toMatch(/^kpn_grexx_[a-z_]+$/);
      expect(t.description).toBeTruthy();
      expect(t.inputSchema.type).toBe("object");
      expect(t.annotations).toMatchObject({
        openWorldHint: true,
      });
      if (t.name === "kpn_grexx_start_line_diagnose") {
        expect(t.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        });
        expect(t.description).not.toContain("⚠");
        expect(t.inputSchema.properties?.[CONFIRM_ARG]).toBeUndefined();
      } else if (
        [
          "kpn_grexx_create_contact",
          "kpn_grexx_update_contact",
          "kpn_grexx_modify_voip_user",
          "kpn_grexx_modify_device_profile",
        ].includes(t.name)
      ) {
        expect(t.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        });
        expect(t.description).toContain("⚠");
        expect(t.description).toMatch(/Confirm with the user before invoking\.$/u);
        expect(t.inputSchema.properties?.[CONFIRM_ARG]).toBeDefined();
      } else {
        expect(t.annotations).toMatchObject({
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: true,
        });
        expect(t.annotations?.destructiveHint ?? false).toBe(false);
        expect(t.description).not.toContain("⚠");
        expect(t.inputSchema.properties?.[CONFIRM_ARG]).toBeUndefined();
      }
      expect(t.description?.toLowerCase()).not.toContain("basic auth is the default");
    }
  });

  it("zipcode_check requires the XSD fields the SDK builder knows", () => {
    const schema = GREXX_TOOLS[1].inputSchema as { required?: string[]; properties?: Record<string, { enum?: string[] }> };
    expect([...(schema.required ?? [])].sort()).toEqual(
      ["houseNumber", "isRoomNumberKnown", "portfolio", "zipCode"].sort()
    );
    expect(schema.properties?.portfolio?.enum).toEqual(["Business", "SMB", "Teleworker", "All"]);
  });

  it("prequalification uses the SDK product-type and supplier enums", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_prequalification");
    const schema = tool?.inputSchema as {
      required?: string[];
      properties?: Record<string, { enum?: readonly string[]; items?: { enum?: readonly string[] } }>;
    };
    expect([...(schema.required ?? [])].sort()).toEqual(
      ["hasBroadband", "hasPhone", "houseNumber", "productTypeCode", "zipCode"].sort()
    );
    expect(schema.properties?.productTypeCode?.enum).toEqual([...PREQUALIFICATION_PRODUCT_TYPES]);
    expect(schema.properties?.suppliers?.items?.enum).toEqual([...PREQUALIFICATION_SUPPLIERS]);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("order_data requires the SDK order id", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_order_data");
    const schema = tool?.inputSchema as {
      required?: string[];
      properties?: Record<string, { type?: string }>;
    };
    expect(schema.required).toEqual(["orderId"]);
    expect(schema.properties?.orderId?.type).toBe("integer");
    expect(Object.keys(schema.properties ?? {})).toEqual(["orderId"]);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("mobile_total_usage requires the XSD customer id and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_mobile_total_usage");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
    expect(schema.required).toEqual(["customerId"]);
    expect(schema.properties?.customerId?.type).toBe("integer");
    expect(Object.keys(schema.properties ?? {})).toEqual(["customerId"]);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("line troubleshooting realtime reads require their XSD inputs and stay read-only", () => {
    const callForwardings = GREXX_TOOLS.find((tool) => tool.name === "kpn_grexx_mobile_call_forwardings");
    expect(callForwardings?.inputSchema).toMatchObject({
      required: ["orderId"],
      properties: { orderId: { type: "integer" } },
    });
    expect(callForwardings?.annotations).toMatchObject({ readOnlyHint: true });

    const module = GREXX_TOOLS.find((tool) => tool.name === "kpn_grexx_mobile_module");
    expect(module?.inputSchema).toMatchObject({
      required: ["orderId"],
      properties: { orderId: { type: "integer" } },
    });
    expect(module?.annotations).toMatchObject({ readOnlyHint: true });

    const plannedLine = GREXX_TOOLS.find((tool) => tool.name === "kpn_grexx_planned_line");
    const plannedLineSchema = plannedLine?.inputSchema as {
      required?: string[];
      properties?: Record<string, { type?: string }>;
    };
    expect(plannedLineSchema.required).toEqual(["houseNumber", "isRoomNumberKnown"]);
    expect(Object.keys(plannedLineSchema.properties ?? {})).toEqual(["zipCode", "houseNumber", "houseNumberExtension", "roomNumber", "isRoomNumberKnown"]);
    expect(plannedLine?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("voip_usage requires the XSD order id and E.164 phone number and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_voip_usage");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string; pattern?: RegExp }> };
    expect(schema.required).toEqual(["orderId", "phoneNumber"]);
    expect(schema.properties?.orderId?.type).toBe("integer");
    expect(schema.properties?.phoneNumber?.pattern).toBe("^\\+\\d{9,15}$");
    expect(Object.keys(schema.properties ?? {})).toEqual(["orderId", "phoneNumber"]);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("voip_total_usage requires the XSD customer id and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_voip_total_usage");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
    expect(schema.required).toEqual(["customerId"]);
    expect(schema.properties?.customerId?.type).toBe("integer");
    expect(Object.keys(schema.properties ?? {})).toEqual(["customerId"]);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("invoice_catalog requires the XSD customer id and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_invoice_catalog");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
    expect(schema.required).toEqual(["customerId"]);
    expect(schema.properties?.customerId?.type).toBe("integer");
    expect(Object.keys(schema.properties ?? {})).toEqual(["customerId"]);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("microsoft_subscription_end_date requires the XSD fields and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_microsoft_subscription_end_date");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
    expect(schema.required).toEqual(["customerId", "productId"]);
    expect(schema.properties?.customerId?.type).toBe("integer");
    expect(schema.properties?.productId?.type).toBe("string");
    expect(schema.properties?.orderId?.type).toBe("integer");
    expect(Object.keys(schema.properties ?? {})).toEqual(["customerId", "productId", "orderId"]);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("upgrade_info requires the XSD order id and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_upgrade_info");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
    expect(schema.required).toEqual(["orderId"]);
    expect(schema.properties?.orderId?.type).toBe("integer");
    expect(Object.keys(schema.properties ?? {})).toEqual(["orderId"]);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("related_products requires the XSD customer id and product code and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_related_products");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
    expect(schema.required).toEqual(["customerId", "productCode"]);
    expect(schema.properties?.customerId?.type).toBe("integer");
    expect(schema.properties?.productCode?.type).toBe("string");
    expect(Object.keys(schema.properties ?? {})).toEqual(["customerId", "productCode"]);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("hip_number_orders requires up to 50 order IDs and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_hip_number_orders");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string; minItems?: number; maxItems?: number }> };
    expect(schema.required).toEqual(["orderIds"]);
    expect(schema.properties?.orderIds?.type).toBe("array");
    expect(schema.properties?.orderIds?.minItems).toBe(1);
    expect(schema.properties?.orderIds?.maxItems).toBe(50);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("clean_internet_info requires the XSD order id and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_clean_internet_info");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
    expect(schema.required).toEqual(["orderId"]);
    expect(Object.keys(schema.properties ?? {})).toEqual(["orderId"]);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("cloud_tenant requires the XSD customer id and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_cloud_tenant");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
    expect(schema.required).toEqual(["customerId"]);
    expect(Object.keys(schema.properties ?? {})).toEqual(["customerId"]);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("microsoft_tenant_exists requires a valid tenant name and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_microsoft_tenant_exists");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string; pattern?: RegExp }> };
    expect(schema.required).toEqual(["tenantName"]);
    expect(schema.properties?.tenantName?.pattern).toBe("^[a-zA-Z0-9._-]{1,27}\\.onmicrosoft\\.com$");
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("microsoft_domain_ownership requires the XSD customer and tenant fields and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_microsoft_domain_ownership");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string; pattern?: RegExp }> };
    expect(schema.required).toEqual(["customerId", "tenantId"]);
    expect(Object.keys(schema.properties ?? {})).toEqual(["customerId", "tenantId"]);
    expect(schema.properties?.tenantId?.pattern).toBe("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("custom_price requires an order and confirmation state and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_custom_price");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
    expect(schema.required).toEqual(["orderId", "confirmationState"]);
    expect(Object.keys(schema.properties ?? {})).toEqual(["orderId", "confirmationState", "remark", "price", "setupPrice", "terminationPrice"]);
    expect(schema.properties?.price?.type).toBe("number");
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("get_contact requires the XSD customer and contact ids and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_get_contact");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
    expect(schema.required).toEqual(["customerId", "contactId"]);
    expect(Object.keys(schema.properties ?? {})).toEqual(["customerId", "contactId"]);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("search_contacts requires paging inputs and stays read-only", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_search_contacts");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string; minItems?: number; maxItems?: number }> };
    expect(schema.required).toEqual(["customerId", "searchParameters", "offset"]);
    expect(Object.keys(schema.properties ?? {})).toEqual(["customerId", "searchParameters", "offset", "limit"]);
    expect(schema.properties?.searchParameters?.type).toBe("object");
    expect(schema.properties?.limit?.type).toBe("integer");
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("create_contact requires the nested contact payload and confirmation", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_create_contact");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string; properties?: Record<string, unknown> }> };
    expect(schema.required).toEqual(["customerId", "contactPostPutRequest"]);
    expect(schema.properties?.contactPostPutRequest?.type).toBe("object");
    expect(schema.properties?.contactPostPutRequest?.properties).toMatchObject({
      displayName: { type: "string" },
      email: { type: "string" },
    });
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool?.description).toMatch(/Confirm with the user before invoking\.$/u);
    expect(schema.properties?.[CONFIRM_ARG]).toMatchObject({ type: "boolean" });
  });

  it("update_contact requires the nested contact payload and confirmation", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_update_contact");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string; properties?: Record<string, unknown> }> };
    expect(schema.required).toEqual(["customerId", "contactId", "contactPostPutRequest"]);
    expect(Object.keys(schema.properties ?? {})).toEqual(["customerId", "contactId", "contactPostPutRequest", CONFIRM_ARG]);
    expect(schema.properties?.contactPostPutRequest?.type).toBe("object");
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool?.description).toMatch(/Confirm with the user before invoking\.$/u);
    expect(schema.properties?.[CONFIRM_ARG]).toMatchObject({ type: "boolean" });
  });

  it("modify_voip_user requires the PBX user fields and confirmation", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_modify_voip_user");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
    expect(schema.required).toEqual(["orderId", "firstName", "lastName"]);
    expect(Object.keys(schema.properties ?? {})).toEqual(["orderId", "firstName", "lastName", "email", "phoneNumber", "extension", CONFIRM_ARG]);
    expect(tool?.description).toContain("changes the PBX user");
    expect(tool?.description).toMatch(/Confirm with the user before invoking\.$/u);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(schema.properties?.[CONFIRM_ARG]).toMatchObject({ type: "boolean" });
  });

  it("modify_device_profile requires the PBX device profile fields and confirmation", () => {
    const tool = GREXX_TOOLS.find((item) => item.name === "kpn_grexx_modify_device_profile");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
    expect(schema.required).toEqual(["orderId", "deviceType", "deviceName", "linePort"]);
    expect(Object.keys(schema.properties ?? {})).toEqual(["orderId", "deviceType", "macAddress", "deviceName", "deviceUserName", "linePort", "sipUserName", CONFIRM_ARG]);
    expect(tool?.description).toContain("changes the PBX device profile");
    expect(tool?.description).toMatch(/Confirm with the user before invoking\.$/u);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(schema.properties?.[CONFIRM_ARG]).toMatchObject({ type: "boolean" });
  });
});

describe("legacy developer.kpn.com catalog", () => {
  it("keeps the 23 design.md tools in order, off the default surface", () => {
    expect(LEGACY_TOOLS).toHaveLength(23);
    expect(LEGACY_NAMES).toEqual(EXPECTED_ORDER);
    expect(TOOLS).not.toBe(LEGACY_TOOLS);
  });

  it("every legacy name matches ^kpn_[a-z_]+$", () => {
    for (const name of LEGACY_NAMES) expect(name).toMatch(/^kpn_[a-z_]+$/);
  });

  it("every legacy tool has a description and an object inputSchema", () => {
    for (const t of LEGACY_TOOLS) {
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
