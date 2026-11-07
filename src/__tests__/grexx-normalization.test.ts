/** Schema validation must not reject strings the Grexx handler normalizes. */
import { describe, expect, it } from "vitest";
import { buildRealtimeBody } from "../handlers/grexx-realtime.js";
import { GREXX_REALTIME_SPECS, realtimeTool } from "../tools/grexx-realtime.js";

const CASES = [
  { tool: "kpn_grexx_planned_line", arg: "zipCode", element: "ZipCode", value: "1012JS", invalid: "abc", args: { houseNumber: 1, isRoomNumberKnown: false } },
  { tool: "kpn_grexx_carrier_info", arg: "phoneNumber", element: "PhoneNumber", value: "0201234567", invalid: "020123", args: { productType: "xDSL", zipCode: "1012 js", houseNumber: 1 } },
  { tool: "kpn_grexx_carrier_info", arg: "israSpecification", element: "IsraSpecification", value: "001", invalid: "01", args: { productType: "xDSL", zipCode: "1012 js", houseNumber: 1 } },
  { tool: "kpn_grexx_carrier_info", arg: "houseNumberExtension", element: "HouseNumberExt", value: "bis", invalid: "abcde", args: { productType: "All", zipCode: "1012 js", houseNumber: 1 } },
  { tool: "kpn_grexx_voip_usage", arg: "phoneNumber", element: "PhoneNumber", value: "+31201234567", invalid: "0201234567", args: { orderId: 123456 } },
  { tool: "kpn_grexx_related_products", arg: "productCode", element: "ProductCode", value: "1234567890123", invalid: "12345678901234", args: { customerId: 28665 } },
  { tool: "kpn_grexx_microsoft_tenant_exists", arg: "tenantName", element: "TenantName", value: "example.onmicrosoft.com", invalid: "example.com", args: {} },
  { tool: "kpn_grexx_microsoft_domain_ownership", arg: "tenantId", element: "TenantId", value: "1b2c3d4e-0000-1111-2222-333344445555", invalid: "not-a-guid", args: { customerId: 28665 } },
];

describe("normalized Grexx string inputs", () => {
  it.each(CASES)("$tool / $arg allows whitespace before handler validation", ({ tool, arg, element, value, args }) => {
    const spec = GREXX_REALTIME_SPECS.find((item) => item.tool === tool)!;
    const schema = realtimeTool(spec).inputSchema.properties?.[arg] as { type?: string; pattern?: string; maxLength?: number };
    expect(schema.type).toBe("string");
    // A raw anchored pattern would reject this input before the handler can trim it.
    expect(schema.pattern).toBeUndefined();
    expect(schema.maxLength).toBeUndefined();
    const body = buildRealtimeBody(spec, { ...args, [arg]: ` \t${value}\n ` });
    expect(body[element]).toBe(value);
    if (tool === "kpn_grexx_carrier_info") expect(body.ZipCode).toBe("1012JS");
  });

  it.each(CASES)("$tool / $arg still rejects invalid normalized input", ({ tool, arg, invalid, args }) => {
    const spec = GREXX_REALTIME_SPECS.find((item) => item.tool === tool)!;
    expect(() => buildRealtimeBody(spec, { ...args, [arg]: ` ${invalid} ` })).toThrow();
  });
});
