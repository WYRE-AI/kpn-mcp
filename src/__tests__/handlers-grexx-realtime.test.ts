/**
 * XSD-spec realtime tools against a mocked GrexxClient.postRealtime.
 * Response fixtures were generated from the response XSDs and validated with lxml.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  GrexxError,
  parseXml,
  readGrexxStatus,
  renderRealtimeBody,
  type GrexxClient,
  type GrexxRealtimeResult,
} from "@wyre-ai/node-kpn";
import { buildRealtimeBody } from "../handlers/grexx-realtime.js";
import { describeGrexxError, handleGrexxToolCall } from "../handlers/index.js";
import { MASK } from "../handlers/masking.js";
import type { ToolResult } from "../handlers/results.js";
import { GREXX_TOOLS } from "../tools/grexx.js";
import { GREXX_REALTIME_SPECS, type GrexxRealtimeSpec } from "../tools/grexx-realtime.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "grexx");

/** Parse an XML string into the shape postRealtime resolves with. */
function realtimeResult(xml: string): GrexxRealtimeResult {
  const document = parseXml(xml);
  const status = readGrexxStatus(document);
  return {
    httpStatus: 200,
    requestId: "req-1",
    rootElement: Object.keys(document)[0],
    code: status.code,
    messages: status.messages,
    rawXml: xml,
    document,
  };
}

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.xml`), "utf8");
}

function stub(xml: string) {
  const postRealtime = vi.fn(async () => realtimeResult(xml));
  return { client: { postRealtime } as unknown as GrexxClient, postRealtime };
}

function text(result: unknown): string {
  return ((result as ToolResult).content[0] as { text: string }).text;
}

function spec(tool: string): GrexxRealtimeSpec {
  return GREXX_REALTIME_SPECS.find((s) => s.tool === tool)!;
}

function nina(code: string, message: string, details = ""): string {
  return (
    `<NinaResponse><IsSuccess>false</IsSuccess><ErrorCode>${code}</ErrorCode><ErrorMessage>${message}</ErrorMessage>` +
    `<ErrorDetails>${details ? `<string>${details}</string>` : ""}</ErrorDetails></NinaResponse>`
  );
}

/**
 * Minimal valid arguments per tool, and the body each must produce. Element
 * names here are typed out from the request XSDs, independently of the specs.
 */
const CASES: Record<string, { args: Record<string, unknown>; body: Record<string, unknown> }> = {
  kpn_grexx_carrier_info: {
    args: { productType: "All", zipCode: "1012 js", houseNumber: 1 },
    body: { ProductType: "All", ZipCode: "1012JS", HouseNumber: 1 },
  },
  kpn_grexx_radius_check: { args: { orderId: 123456 }, body: { OrderId: 123456 } },
  kpn_grexx_ras_check: { args: { orderId: "123456" }, body: { OrderId: 123456 } },
  kpn_grexx_start_line_diagnose: {
    args: { orderId: 123456, symptomCode: "Sym103" },
    body: { OrderId: 123456, SymptomCode: "Sym103" },
  },
  kpn_grexx_customer_data: { args: { name: "Duck", take: 5 }, body: { Name: "Duck", Take: 5 } },
  kpn_grexx_order_summary: {
    args: { customerId: 28665, dateModifiedFrom: "2025-01-01T00:00:00Z" },
    body: { CustomerId: 28665, DateModifiedFrom: "2025-01-01T00:00:00Z" },
  },
  kpn_grexx_get_sim: { args: { orderId: 123456 }, body: { OrderId: 123456 } },
  kpn_grexx_mobile_settings: { args: { orderId: 123456 }, body: { OrderId: 123456 } },
  kpn_grexx_mobile_usage: { args: { orderId: 123456 }, body: { OrderId: 123456 } },
  kpn_grexx_mobile_orders: { args: { orderIds: [1, 2] }, body: { OrderIds: { OrderId: [1, 2] } } },
  kpn_grexx_available_portings: { args: { customerId: 28665 }, body: { MobileSubscripionCustomerId: 28665 } },
};

describe("realtime tool surface", () => {
  it("appends every spec after the node-kpn builder tools", () => {
    expect(GREXX_TOOLS.map((t) => t.name)).toEqual([
      "kpn_grexx_test_connection",
      "kpn_grexx_zipcode_check",
      "kpn_grexx_prequalification",
      "kpn_grexx_order_data",
      ...GREXX_REALTIME_SPECS.map((s) => s.tool),
    ]);
    expect(Object.keys(CASES).sort()).toEqual(GREXX_REALTIME_SPECS.map((s) => s.tool).sort());
  });

  it("exposes each XSD field as a schema property and lists required fields", () => {
    for (const s of GREXX_REALTIME_SPECS) {
      const tool = GREXX_TOOLS.find((t) => t.name === s.tool)!;
      const schema = tool.inputSchema as { properties: Record<string, unknown>; required?: string[] };
      expect(Object.keys(schema.properties), s.tool).toEqual(s.fields.map((f) => f.arg));
      expect(schema.required ?? [], s.tool).toEqual(s.fields.filter((f) => f.required).map((f) => f.arg));
    }
  });

  it("marks start_line_diagnose as not read-only and every other spec as read-only", () => {
    for (const s of GREXX_REALTIME_SPECS) {
      const tool = GREXX_TOOLS.find((t) => t.name === s.tool)!;
      const readOnly = s.tool !== "kpn_grexx_start_line_diagnose";
      expect(tool.annotations?.readOnlyHint, s.tool).toBe(readOnly);
      expect(tool.annotations?.destructiveHint ?? false, s.tool).toBe(false);
    }
  });
});

describe("request bodies", () => {
  it.each(Object.entries(CASES))("%s posts the XSD body for its arguments", async (tool, { args, body }) => {
    const { client, postRealtime } = stub(fixture(spec(tool).response));
    await handleGrexxToolCall(client, tool, args);
    expect(postRealtime).toHaveBeenCalledWith(spec(tool).request, body, {
      idempotent: tool !== "kpn_grexx_start_line_diagnose",
    });
  });

  it("emits elements in XSD order regardless of argument order", () => {
    const body = buildRealtimeBody(spec("kpn_grexx_order_summary"), {
      take: 4,
      productGroup: "Mobile",
      orderState: "Active",
      customerId: 1,
    });
    const xml = renderRealtimeBody("OrderSummaryRequest_V1", body);
    expect(xml).toContain(
      "<OrderSummaryRequest_V1><CustomerId>1</CustomerId><OrderState>Active</OrderState>" +
        "<ProductGroup>Mobile</ProductGroup><Take>4</Take></OrderSummaryRequest_V1>"
    );
  });

  it("wraps list fields in their XSD item element", () => {
    const orders = renderRealtimeBody(
      "GetMobileSubscriptionOrdersRequest_V1",
      buildRealtimeBody(spec("kpn_grexx_mobile_orders"), { orderIds: [1, "2"] })
    );
    expect(orders).toContain("<OrderIds><OrderId>1</OrderId><OrderId>2</OrderId></OrderIds>");
  });

  it("omits optional arguments that were not passed", () => {
    expect(buildRealtimeBody(spec("kpn_grexx_customer_data"), {})).toEqual({});
  });

  it.each([
    ["kpn_grexx_get_sim", {}, 'Argument "orderId" is required.'],
    ["kpn_grexx_get_sim", { orderId: 1.5 }, "must be an integer"],
    ["kpn_grexx_get_sim", { orderId: "0x10" }, "must be an integer"],
    ["kpn_grexx_get_sim", { orderId: 3000000000 }, "at most 2147483647"],
    ["kpn_grexx_order_summary", { skip: 3000000000 }, "at most 2147483647"],
    ["kpn_grexx_customer_data", { take: 101 }, "at most 100"],
    ["kpn_grexx_order_summary", { take: 2501 }, "at most 2500"],
    ["kpn_grexx_order_summary", { orderState: "Open" }, "must be one of"],
    ["kpn_grexx_order_summary", { dateActiveFrom: "yesterday" }, "xs:dateTime"],
    ["kpn_grexx_order_summary", { dateModifiedFrom: "2025-01-01" }, "xs:dateTime"],
    ["kpn_grexx_carrier_info", { ...CASES.kpn_grexx_carrier_info.args, phoneNumber: "612345678" }, "does not match"],
    ["kpn_grexx_carrier_info", { ...CASES.kpn_grexx_carrier_info.args, houseNumber: 100000 }, "at most 99999"],
    ["kpn_grexx_mobile_orders", { orderIds: [] }, "at least 1"],
    ["kpn_grexx_mobile_orders", { orderIds: Array.from({ length: 51 }, (_, i) => i + 1) }, "at most 50"],
    ["kpn_grexx_available_portings", {}, "exactly one"],
    ["kpn_grexx_available_portings", { customerId: 1, hipGroupOrderId: 2 }, "exactly one"],
    ["kpn_grexx_start_line_diagnose", { orderId: 1, symptomCode: "Sym999" }, "Sym103"],
  ])("%s rejects %j without calling Grexx", async (tool, args, message) => {
    const { client, postRealtime } = stub(fixture("OrderDataResponse_V1"));
    const result = (await handleGrexxToolCall(client, tool, args)) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(`Invalid arguments for ${tool}`);
    expect(text(result)).toContain(message);
    expect(postRealtime).not.toHaveBeenCalled();
  });

  it("accepts the xs:dateTime forms IRMA accepts", () => {
    for (const value of ["2025-01-01T00:00:00", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00.000+02:00"]) {
      expect(buildRealtimeBody(spec("kpn_grexx_order_summary"), { dateActiveFrom: value })).toEqual({
        DateActiveFrom: value,
      });
    }
  });
});

describe("responses", () => {
  it.each(GREXX_REALTIME_SPECS.map((s) => [s.tool, s]))(
    "%s returns the parsed response without Status or raw XML",
    async (_tool, s) => {
      const { client } = stub(fixture(s.response));
      const result = (await handleGrexxToolCall(client, s.tool, CASES[s.tool].args)) as ToolResult;
      expect(result.isError, text(result)).toBeUndefined();
      const body = JSON.parse(text(result));
      expect(body.request).toBe(s.request);
      expect(body.response).toBe(s.response);
      expect(body.requestId).toBe("req-1");
      expect(body.data).not.toHaveProperty("Status");
      expect(Object.keys(body.data).length).toBeGreaterThan(0);
      expect(text(result)).not.toContain("<?xml");
    }
  );

  it("masks the PUK and eSIM codes from GetSim", async () => {
    const { client } = stub(fixture("GetSimResponse_V1"));
    const raw = text(await handleGrexxToolCall(client, "kpn_grexx_get_sim", { orderId: 1 }));
    const body = JSON.parse(raw);
    expect(body.secretsMasked).toBe(true);
    expect(body.data.Sim.Puc1).toBe(MASK);
    expect(body.data.Sim.SimCard.Puc1).toBe(MASK);
    expect(body.data.Sim.ESim.ActivationCode).toBe(MASK);
    expect(body.data.Sim.ESim.ConfirmationCode).toBe(MASK);
    expect(body.data.Sim.ICCId).toBeTruthy();
    expect(raw).not.toContain("12345678");
  });

  it("masks SIM codes inside mobile orders and the PPP password from RadiusCheck", async () => {
    const orders = JSON.parse(
      text(await handleGrexxToolCall(stub(fixture("GetMobileSubscriptionOrdersResponse_V1")).client, "kpn_grexx_mobile_orders", { orderIds: [1] }))
    );
    expect(orders.secretsMasked).toBe(true);
    expect(JSON.stringify(orders)).not.toMatch(/"Puc1":"(?!••••)/);
    const radius = text(await handleGrexxToolCall(stub(fixture("RadiusCheckResponse_V1")).client, "kpn_grexx_radius_check", { orderId: 1 }));
    expect(JSON.parse(radius).secretsMasked).toBe(true);
    expect(radius).toMatch(/"Password": "••••"/);
  });

  it("reports the HTTP 200 NinaResponse rejection as an error with its code and details", async () => {
    const xml = nina("109", "XML validation error", "The element 'OrderSummaryRequest_V1' has invalid child element 'OrderState'.");
    const result = (await handleGrexxToolCall(stub(xml).client, "kpn_grexx_order_summary", { customerId: 1 })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("109");
    expect(text(result)).toContain("XML validation error");
    expect(text(result)).toContain("invalid child element 'OrderState'");
  });

  it("gives NinaResponse 108 and 102 the SDK's rate-limit and IP hints", async () => {
    const limited = text(await handleGrexxToolCall(stub(nina("108", "Too Many Requests")).client, "kpn_grexx_get_sim", { orderId: 1 }));
    expect(limited).toContain("Rate limited (108 Too Many Requests)");
    const forbidden = text(await handleGrexxToolCall(stub(nina("102", "Wrong username/password or ip address not allowed")).client, "kpn_grexx_get_sim", { orderId: 1 }));
    expect(forbidden).toContain("Grexx rejected the caller IP (code 102)");
  });

  it("rejects an unexpected response root without echoing the body", async () => {
    const result = (await handleGrexxToolCall(
      stub("<html><body>maintenance</body></html>").client,
      "kpn_grexx_order_summary",
      { customerId: 1 }
    )) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Expected OrderSummaryResponse_V1 but received <html>");
    expect(text(result)).not.toContain("maintenance");
  });

  it("treats a root ErrorMessage as an error without echoing the response data", async () => {
    const xml =
      "<RadiusCheckResponse_V1><ErrorMessage>Radius check niet beschikbaar voor dit product</ErrorMessage>" +
      "<ResponseItems><ResponseItem><Username>jan@example.nl</Username></ResponseItem></ResponseItems></RadiusCheckResponse_V1>";
    const result = (await handleGrexxToolCall(stub(xml).client, "kpn_grexx_radius_check", { orderId: 1 })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Radius check niet beschikbaar voor dit product");
    expect(text(result)).toContain('"response": "RadiusCheckResponse_V1"');
    expect(text(result)).not.toContain('"data"');
    expect(text(result)).not.toContain("jan@example.nl");
  });
});

describe("describeGrexxError", () => {
  it("never echoes a raw response body, which can hold SIM secrets", () => {
    const body = '<?xml version="1.0"?><GetSimResponse_V1><Status><Code>213</Code></Status><Sim><Puc1>98765432</Puc1></Sim></GetSimResponse_V1>';
    const message = describeGrexxError(new GrexxError(body, 200, body, "213"), "kpn_grexx_get_sim");
    expect(message).toContain("Grexx error (HTTP 200, 213)");
    expect(message).not.toContain("98765432");
    expect(message).not.toContain("<");
  });

  it("describes a NinaResponse that a node-kpn builder rejected as an unexpected root", () => {
    const raw = nina("107", "Message type not allowed");
    const error = new GrexxError("Expected PrequalificationResponse_V1 but received <NinaResponse>", 200, raw, undefined, "rid");
    const message = describeGrexxError(error, "kpn_grexx_prequalification");
    expect(message).toContain("Grexx error (HTTP 200, 107): Message type not allowed");
    expect(message).toContain("rid");
  });
});
