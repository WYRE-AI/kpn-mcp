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
import { CONFIRM_ARG } from "../elicitation.js";
import type { ToolResult } from "../handlers/results.js";
import { GREXX_TOOLS } from "../tools/grexx.js";
import { GREXX_REALTIME_SPECS, type GrexxRealtimeSpec } from "../tools/grexx-realtime.js";
import { GREXX_REALTIME_TOOLS } from "../tools/grexx-realtime.js";

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
  kpn_grexx_mobile_total_usage: { args: { customerId: 28665 }, body: { CustomerId: 28665 } },
  kpn_grexx_mobile_orders: { args: { orderIds: [1, 2] }, body: { OrderIds: { OrderId: [1, 2] } } },
  kpn_grexx_mobile_call_forwardings: { args: { orderId: 123456 }, body: { OrderId: 123456 } },
  kpn_grexx_mobile_preferences: { args: { orderId: 123456 }, body: { OrderId: 123456 } },
  kpn_grexx_mobile_module: { args: { orderId: 123456 }, body: { OrderId: 123456 } },
  kpn_grexx_planned_line: {
    args: { zipCode: "1012JS", houseNumber: 1, isRoomNumberKnown: true },
    body: { ZipCode: "1012JS", HouseNr: 1, IsRoomNumberKnown: true },
  },
  kpn_grexx_voip_usage: { args: { orderId: 123456, phoneNumber: "+31612345678" }, body: { OrderId: 123456, PhoneNumber: "+31612345678" } },
  kpn_grexx_voip_total_usage: { args: { customerId: 28665 }, body: { CustomerId: 28665 } },
  kpn_grexx_available_portings: { args: { customerId: 28665 }, body: { MobileSubscripionCustomerId: 28665 } },
  kpn_grexx_invoice_catalog: { args: { customerId: 28665 }, body: { CustomerId: 28665 } },
  kpn_grexx_microsoft_subscription_end_date: {
    args: { customerId: 28665, productId: "MS-001", orderId: 123456 },
    body: { CustomerId: 28665, ProductId: "MS-001", OrderId: 123456 },
  },
  kpn_grexx_upgrade_info: { args: { orderId: 123456 }, body: { OrderId: 123456 } },
  kpn_grexx_related_products: { args: { customerId: 28665, productCode: "MOB-001" }, body: { CustomerId: 28665, ProductCode: "MOB-001" } },
  kpn_grexx_hip_number_orders: { args: { orderIds: [123456, 123457] }, body: { OrderIds: { OrderId: [123456, 123457] } } },
  kpn_grexx_clean_internet_info: { args: { orderId: 123456 }, body: { OrderId: 123456 } },
  kpn_grexx_cloud_tenant: { args: { customerId: 28665 }, body: { CustomerId: 28665 } },
  kpn_grexx_microsoft_tenant_exists: { args: { tenantName: "uwdomein.onmicrosoft.com" }, body: { TenantName: "uwdomein.onmicrosoft.com" } },
  kpn_grexx_microsoft_domain_ownership: {
    args: { customerId: 28665, tenantId: "12345678-1234-1234-1234-123456789012" },
    body: { CustomerId: 28665, TenantId: "12345678-1234-1234-1234-123456789012" },
  },
  kpn_grexx_custom_price: { args: { orderId: 123456, confirmationState: "Accepted" }, body: { OrderId: 123456, ConfirmationState: "Accepted" } },
  kpn_grexx_get_contact: { args: { customerId: 28665, contactId: 1 }, body: { CustomerId: 28665, ContactId: 1 } },
  kpn_grexx_search_contacts: {
    args: {
      customerId: 28665,
      searchParameters: {
        keyword: "Duck",
        enabledSystemNotification: ["Primary"],
        enabledThresholdAlert: ["CustomerVoipBlockingLimit"],
      },
      offset: 1,
      limit: 20,
    },
    body: {
      CustomerId: 28665,
      SearchParameters: {
        KeyWord: "Duck",
        EnabledSystemNotification: ["Primary"],
        EnabledThresholdAlert: ["CustomerVoipBlockingLimit"],
      },
      Offset: 1,
      Limit: 20,
    },
  },
  kpn_grexx_create_contact: {
    args: {
      customerId: 28665,
      confirm_destructive_action: true,
      contactPostPutRequest: {
        displayName: "Duck Jansen",
        email: "duck.jansen@example.invalid",
        phone1: "0612345678",
        phone2: "0645678910",
        notificationPreferences: {
          enabledSystemNotifications: ["Primary"],
          enabledNewsNotifications: ["RoutITSales"],
          enabledThresholdAlerts: ["CustomerVoipBlockingLimit"],
        },
      },
    },
    body: {
      CustomerId: 28665,
      ContactPostPutRequest: {
        DisplayName: "Duck Jansen",
        Email: "duck.jansen@example.invalid",
        Phone1: "0612345678",
        Phone2: "0645678910",
        NotificationPreferences: {
          EnabledSystemNotifications: ["Primary"],
          EnabledNewsNotifications: ["RoutITSales"],
          EnabledThresholdAlerts: ["CustomerVoipBlockingLimit"],
        },
      },
    },
  },
  kpn_grexx_update_contact: {
    args: {
      customerId: 28665,
      contactId: 1,
      confirm_destructive_action: true,
      contactPostPutRequest: {
        displayName: "Duck Jansen",
        email: "duck.jansen@example.invalid",
        phone1: "0612345678",
        phone2: "0645678910",
        notificationPreferences: {
          enabledSystemNotifications: ["Primary"],
          enabledNewsNotifications: ["RoutITSales"],
          enabledThresholdAlerts: ["CustomerVoipBlockingLimit"],
        },
      },
    },
    body: {
      CustomerId: 28665,
      ContactId: 1,
      ContactPostPutRequest: {
        DisplayName: "Duck Jansen",
        Email: "duck.jansen@example.invalid",
        Phone1: "0612345678",
        Phone2: "0645678910",
        NotificationPreferences: {
          EnabledSystemNotifications: ["Primary"],
          EnabledNewsNotifications: ["RoutITSales"],
          EnabledThresholdAlerts: ["CustomerVoipBlockingLimit"],
        },
      },
    },
  },
  kpn_grexx_modify_voip_user: {
    args: {
      orderId: 123456,
      confirm_destructive_action: true,
      firstName: "Duck",
      lastName: "Jansen",
      email: "duck.jansen@example.invalid",
      phoneNumber: "+31612345678",
      extension: "12",
    },
    body: {
      OrderId: 123456,
      FirstName: "Duck",
      LastName: "Jansen",
      Email: "duck.jansen@example.invalid",
      PhoneNumber: "+31612345678",
      Extension: "12",
    },
  },
  kpn_grexx_modify_device_profile: {
    args: {
      orderId: 123456,
      confirm_destructive_action: true,
      deviceType: "Yealink T46G",
      macAddress: "AA:BB:CC:DD:EE:FF",
      deviceName: "Duck T46G",
      deviceUserName: "duck.t46g",
      linePort: "12345",
      sipUserName: "sip.duck",
    },
    body: {
      OrderId: 123456,
      DeviceType: "Yealink T46G",
      MacAddress: "AA:BB:CC:DD:EE:FF",
      DeviceName: "Duck T46G",
      DeviceUserName: "duck.t46g",
      LinePort: "12345",
      SipUserName: "sip.duck",
    },
  },
};

describe("realtime tool surface", () => {
  it("appends every non-admin realtime spec after the node-kpn builder tools", () => {
    expect(GREXX_REALTIME_TOOLS.map((t) => t.name)).toEqual(
      GREXX_REALTIME_SPECS.filter((spec) => !spec.admin).map((spec) => spec.tool)
    );
    expect(Object.keys(CASES).sort()).toEqual(
      GREXX_REALTIME_SPECS.filter((spec) => !spec.admin).map((spec) => spec.tool).sort()
    );
  });

  it("does not list the admin contact delete by default", () => {
    expect(GREXX_REALTIME_TOOLS.map((tool) => tool.name)).not.toContain("kpn_grexx_delete_contact");
    expect(GREXX_TOOLS.map((tool) => tool.name)).not.toContain("kpn_grexx_delete_contact");
  });

  it("appends the KPN-B5 WilroffReitsma contact and VOIP tools after the existing specs", () => {
    expect(GREXX_REALTIME_SPECS.filter((spec) => !spec.admin).slice(-6).map((spec) => spec.tool)).toEqual([
      "kpn_grexx_get_contact",
      "kpn_grexx_search_contacts",
      "kpn_grexx_create_contact",
      "kpn_grexx_update_contact",
      "kpn_grexx_modify_voip_user",
      "kpn_grexx_modify_device_profile",
    ]);
  });

  it("exposes each flat XSD field as a schema property and lists required fields", () => {
    for (const spec of GREXX_REALTIME_SPECS) {
      if (spec.admin) continue;
      const tool = GREXX_TOOLS.find((item) => item.name === spec.tool)!;
      const schema = tool.inputSchema as { properties: Record<string, unknown>; required?: string[] };
      expect(Object.keys(schema.properties), spec.tool).toEqual([
        ...spec.fields.map((field) => field.arg),
        ...(spec.confirm || spec.admin ? [CONFIRM_ARG] : []),
      ]);
      expect(schema.required ?? [], spec.tool).toEqual(
        spec.fields.filter((field) => field.required).map((field) => field.arg)
      );
    }
  });

  it("marks the realtime start and write tools with the correct read-only state", () => {
    for (const spec of GREXX_REALTIME_SPECS) {
      if (spec.admin) continue;
      const tool = GREXX_TOOLS.find((item) => item.name === spec.tool)!;
      const readOnly = spec.readOnly !== false;
      expect(tool.annotations?.readOnlyHint, spec.tool).toBe(readOnly);
      const destructiveHint = tool.annotations?.destructiveHint ?? false;
      expect(destructiveHint, spec.tool).toBe(spec.destructive === true);
    }
  });

  it("marks the KPN-B4 realtime reads as read-only", () => {
    for (const tool of [
      "kpn_grexx_hip_number_orders",
      "kpn_grexx_clean_internet_info",
      "kpn_grexx_cloud_tenant",
      "kpn_grexx_microsoft_tenant_exists",
      "kpn_grexx_microsoft_domain_ownership",
      "kpn_grexx_custom_price",
    ]) {
      const toolDefinition = GREXX_TOOLS.find((item) => item.name === tool)!;
      expect(toolDefinition.annotations).toMatchObject({ readOnlyHint: true });
    }
  });
});

describe("request bodies", () => {
  it.each(Object.entries(CASES))("%s posts the XSD body for its arguments", async (tool, { args, body }) => {
    const { client, postRealtime } = stub(fixture(spec(tool).response));
    await handleGrexxToolCall(client, tool, args);
    expect(postRealtime).toHaveBeenCalledWith(spec(tool).request, body, {
      idempotent: spec(tool).readOnly !== false,
    });
  });

  it.each([
    ["kpn_grexx_create_contact", { customerId: 28665, contactPostPutRequest: { displayName: "Duck Jansen", email: "duck.jansen@example.invalid" } }],
    ["kpn_grexx_update_contact", { customerId: 28665, contactId: 1, contactPostPutRequest: { displayName: "Duck Jansen", email: "duck.jansen@example.invalid" } }],
    ["kpn_grexx_modify_voip_user", { orderId: 123456, firstName: "Duck", lastName: "Jansen" }],
    ["kpn_grexx_modify_device_profile", { orderId: 123456, deviceType: "Yealink T46G", deviceName: "Duck T46G", linePort: "12345" }],
  ])("%s blocks an unconfirmed mutation before Grexx", async (tool, args) => {
    const { client, postRealtime } = stub(fixture(spec(tool).response));
    const result = (await handleGrexxToolCall(client, tool, args)) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(CONFIRM_ARG);
    expect(postRealtime).not.toHaveBeenCalled();
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

  it("emits planned line elements in XSD order", () => {
    const xml = renderRealtimeBody(
      "PlannedLineRequest_V3",
      buildRealtimeBody(spec("kpn_grexx_planned_line"), {
        houseNumberExtension: "A",
        roomNumber: "2",
        zipCode: "1012JS",
        houseNumber: 1,
        isRoomNumberKnown: true,
      })
    );
    expect(xml).toContain(
      "<PlannedLineRequest_V3><ZipCode>1012JS</ZipCode><HouseNr>1</HouseNr>" +
        "<HouseNrExtension>A</HouseNrExtension><RoomNumber>2</RoomNumber><IsRoomNumberKnown>true</IsRoomNumberKnown>" +
        "</PlannedLineRequest_V3>"
    );
  });

  it("emits contact and PBX mutation elements in XSD order", () => {
    const create = renderRealtimeBody(
      "CreateContactRequest_V1",
      buildRealtimeBody(spec("kpn_grexx_create_contact"), CASES.kpn_grexx_create_contact.args)
    );
    expect(create).toContain("<CreateContactRequest_V1><CustomerId>28665</CustomerId><ContactPostPutRequest><DisplayName>Duck Jansen</DisplayName>");
    expect(create).toContain("<ContactPostPutRequest><DisplayName>Duck Jansen</DisplayName>");

    const update = renderRealtimeBody(
      "UpdateContactRequest_V1",
      buildRealtimeBody(spec("kpn_grexx_update_contact"), CASES.kpn_grexx_update_contact.args)
    );
    expect(update).toContain("<UpdateContactRequest_V1><CustomerId>28665</CustomerId><ContactId>1</ContactId>");
    expect(update).toContain("<ContactPostPutRequest><DisplayName>Duck Jansen</DisplayName>");

    const voip = renderRealtimeBody(
      "ModifyVoipUserRequest_V1",
      buildRealtimeBody(spec("kpn_grexx_modify_voip_user"), CASES.kpn_grexx_modify_voip_user.args)
    );
    expect(voip).toContain("<ModifyVoipUserRequest_V1><OrderId>123456</OrderId><FirstName>Duck</FirstName>");
    expect(voip).toContain("<FirstName>Duck</FirstName><LastName>Jansen</LastName>");

    const device = renderRealtimeBody(
      "ModifyDeviceProfileRequest_V1",
      buildRealtimeBody(spec("kpn_grexx_modify_device_profile"), CASES.kpn_grexx_modify_device_profile.args)
    );
    expect(device).toContain("<ModifyDeviceProfileRequest_V1><OrderId>123456</OrderId><DeviceType>Yealink T46G</DeviceType>");
    expect(device).toContain("<ModifyDeviceProfileRequest_V1><OrderId>123456</OrderId><DeviceType>Yealink T46G</DeviceType>");
  });

  it.each([
    ["kpn_grexx_create_contact", { customerId: 28665, contactPostPutRequest: { email: "duck.jansen@example.invalid" } }, 'Argument "displayName" is required.'],
    ["kpn_grexx_update_contact", { customerId: 28665, contactId: 1, contactPostPutRequest: { displayName: "Duck Jansen" } }, 'Argument "email" is required.'],
    ["kpn_grexx_modify_voip_user", { orderId: 123456, firstName: "Duck" }, 'Argument "lastName" is required.'],
    ["kpn_grexx_modify_device_profile", { orderId: 123456, deviceType: "Yealink T46G", deviceName: "Duck T46G" }, 'Argument "linePort" is required.'],
  ])("%s rejects invalid arguments without calling Grexx", async (tool, args, message) => {
    const { client, postRealtime } = stub(fixture("ContactResponse_V1"));
    const result = (await handleGrexxToolCall(client, tool, { ...args, confirm_destructive_action: true })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(`Invalid arguments for ${tool}`);
    expect(text(result)).toContain(message);
    expect(postRealtime).not.toHaveBeenCalled();
  });

  it("wraps list fields in their XSD item element", () => {
    const orders = renderRealtimeBody(
      "GetMobileSubscriptionOrdersRequest_V1",
      buildRealtimeBody(spec("kpn_grexx_mobile_orders"), { orderIds: [1, "2"] })
    );
    expect(orders).toContain("<OrderIds><OrderId>1</OrderId><OrderId>2</OrderId></OrderIds>");
  });

  it("emits HIP number orders in XSD order", () => {
    const xml = renderRealtimeBody(
      "GetHipPhoneNumberOrdersRequest_V1",
      buildRealtimeBody(spec("kpn_grexx_hip_number_orders"), { orderIds: [123456, 123457] })
    );
    expect(xml).toContain("<GetHipPhoneNumberOrdersRequest_V1><OrderIds><OrderId>123456</OrderId><OrderId>123457</OrderId></OrderIds></GetHipPhoneNumberOrdersRequest_V1>");
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
    ["kpn_grexx_mobile_total_usage", { customerId: 2147483648 }, "at most 2147483647"],
    ["kpn_grexx_voip_usage", { orderId: 1, phoneNumber: "0612345678" }, "does not match"],
    ["kpn_grexx_voip_usage", {}, 'Argument "orderId" is required.'],
    ["kpn_grexx_mobile_call_forwardings", {}, 'Argument "orderId" is required.'],
    ["kpn_grexx_mobile_preferences", {}, 'Argument "orderId" is required.'],
    ["kpn_grexx_mobile_module", {}, 'Argument "orderId" is required.'],
    ["kpn_grexx_planned_line", {}, 'Argument "houseNumber" is required.'],
    ["kpn_grexx_planned_line", { houseNumber: 1 }, 'Argument "isRoomNumberKnown" is required.'],
    ["kpn_grexx_planned_line", { houseNumber: 1, isRoomNumberKnown: "true" }, "must be a boolean"],
    ["kpn_grexx_invoice_catalog", {}, 'Argument "customerId" is required.'],
    ["kpn_grexx_available_portings", {}, "exactly one"],
    ["kpn_grexx_available_portings", { customerId: 1, hipGroupOrderId: 2 }, "exactly one"],
    ["kpn_grexx_start_line_diagnose", { orderId: 1, symptomCode: "Sym999" }, "Sym103"],
    ["kpn_grexx_microsoft_subscription_end_date", { customerId: 28665 }, 'Argument "productId" is required.'],
    ["kpn_grexx_microsoft_subscription_end_date", { customerId: 28665, productId: "MS-001", orderId: 0 }, "at least 1"],
    ["kpn_grexx_upgrade_info", {}, 'Argument "orderId" is required.'],
    ["kpn_grexx_related_products", { customerId: 28665 }, 'Argument "productCode" is required.'],
    ["kpn_grexx_related_products", { customerId: 28665, productCode: "MOB-0012345678901234" }, "at most 13"],
    ["kpn_grexx_hip_number_orders", { orderIds: [] }, "at least 1"],
    ["kpn_grexx_hip_number_orders", { orderIds: Array.from({ length: 51 }, (_, index) => index + 1) }, "at most 50"],
    ["kpn_grexx_clean_internet_info", {}, 'Argument "orderId" is required.'],
    ["kpn_grexx_cloud_tenant", {}, 'Argument "customerId" is required.'],
    ["kpn_grexx_microsoft_tenant_exists", { tenantName: "uwdomein.example.com" }, "does not match"],
    ["kpn_grexx_microsoft_domain_ownership", { customerId: 28665, tenantId: "not-a-uuid" }, "does not match"],
    ["kpn_grexx_custom_price", { orderId: 123456 }, 'Argument "confirmationState" is required.'],
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
      if (s.admin) return;
      const { client } = stub(fixture(s.response));
      const result = (await handleGrexxToolCall(client, s.tool, CASES[s.tool].args)) as ToolResult;
      expect(result.isError, text(result)).toBeUndefined();
      const body = JSON.parse(text(result));
      expect(body.request).toBe(s.request);
      expect(body.response).toBe(s.response);
      expect(body.requestId).toBe("req-1");
      expect(body.data).not.toHaveProperty("Status");
      expect(Object.keys(body.data).length).toBeGreaterThanOrEqual(0);
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

  it("parses a single contact from its response fixture", async () => {
    const result = (await handleGrexxToolCall(stub(fixture("ContactResponse_V1")).client, "kpn_grexx_get_contact", {
      customerId: 28665,
      contactId: 1,
    })) as ToolResult;
    const body = JSON.parse(text(result));
    expect(body.data.ContactId).toBe("1");
    expect(body.data.DisplayName).toBe("Duck Jansen");
    expect(body.data.Email).toBe("duck.jansen@example.invalid");
    expect(body.data.Phone1).toBe("0612345678");
    expect(body.data.Phone2).toBe("0645678910");
    expect(body.data.IsUserContact).toBe("true");
    expect(body.secretsMasked).toBeUndefined();
  });

  it("masks PBX device passwords from its response fixture", async () => {
    const result = (await handleGrexxToolCall(stub(fixture("ModifyDeviceProfileResponse_V1")).client, "kpn_grexx_modify_device_profile", {
      orderId: 123456,
      confirm_destructive_action: true,
      deviceType: "Yealink T46G",
      deviceName: "Duck T46G",
      linePort: "12345",
    })) as ToolResult;
    const body = JSON.parse(text(result));
    expect(body.secretsMasked).toBe(true);
    expect(body.data.Password).toBe(MASK);
    expect(body.data.SipPassword).toBe(MASK);
  });

  it("parses mobile total usage from its response fixture", async () => {
    const { client } = stub(fixture("GetMobileSubscriptionTotalUsageResponse_V1"));
    const result = (await handleGrexxToolCall(client, "kpn_grexx_mobile_total_usage", { customerId: 28665 })) as ToolResult;
    const body = JSON.parse(text(result));
    expect(body.secretsMasked).toBeUndefined();
    expect(body.data.CustomerId).toBe("28665");
    expect(body.data.MobileBundleInfoUsage.MobileBundleInfoUsage_V1.DataCurrentValue).toBe("3456.78");
  });

  it("parses VOIP usage and total usage from their response fixtures", async () => {
    const usage = JSON.parse(
      text(await handleGrexxToolCall(stub(fixture("GetVoipUsageResponse_V1")).client, "kpn_grexx_voip_usage", {
        orderId: 123456,
        phoneNumber: "+31612345678",
      }))
    );
    expect(usage.data.VoipUsage.CountCalls).toBe("12");
    expect(usage.data.VoipUsage.Amount).toBe("3.5");

    const total = JSON.parse(
      text(await handleGrexxToolCall(stub(fixture("GetVoipTotalUsageResponse_V1")).client, "kpn_grexx_voip_total_usage", {
        customerId: 28665,
      }))
    );
    expect(total.data.VoipUsages.VoipUsage_V1.DurationInSeconds).toBe("1250");
  });

  it("parses the invoice catalog from its response fixture", async () => {
    const result = (await handleGrexxToolCall(stub(fixture("CustomerInvoiceCatalogResponse_V1")).client, "kpn_grexx_invoice_catalog", {
      customerId: 28665,
    })) as ToolResult;
    const body = JSON.parse(text(result));
    expect(body.data.CustomerInvoiceCatalogItems.CustomerInvoiceCatalogItem_V1.InvoiceNumber).toBe("INV-2026-001");
    expect(body.data.CustomerInvoiceCatalogItems.CustomerInvoiceCatalogItem_V1.TotalAmountIncludingVat).toBe("123.45");
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

  it("parses mobile call forwardings from its response fixture", async () => {
    const result = (await handleGrexxToolCall(stub(fixture("GetMobileCallForwardingsResponse_V1")).client, "kpn_grexx_mobile_call_forwardings", {
      orderId: 123456,
    })) as ToolResult;
    const body = JSON.parse(text(result));
    expect(body.data.CallForwardings.CallForwardingUnconditional.PhoneNumber).toBe("0612345678");
    expect(body.data.CallForwardings.CallForwardingUnconditional.Pending).toBe("false");
  });

  it("parses mobile preferences from its response fixture", async () => {
    const result = (await handleGrexxToolCall(stub(fixture("GetMobilePreferencesResponse_V1")).client, "kpn_grexx_mobile_preferences", {
      orderId: 123456,
    })) as ToolResult;
    const body = JSON.parse(text(result));
    expect(body.data.RatesAbroadNotificationsEnabled).toBe("true");
    expect(body.data.DataUsageNotificationsEnabled).toBe("false");
    expect(body.data.SimBlock).toBe("false");
  });

  it("parses the mobile module from its response fixture", async () => {
    const result = (await handleGrexxToolCall(stub(fixture("GetMobileModuleResponse_V1")).client, "kpn_grexx_mobile_module", {
      orderId: 123456,
    })) as ToolResult;
    const body = JSON.parse(text(result));
    expect(body.data.MobileModule.Code).toBe("MOB-001");
    expect(body.data.MobileModule.Status.IsPending).toBe("false");
    expect(body.data.MobileModule.Status.Value).toBe("true");
  });

  it("parses planned line results from its response fixture", async () => {
    const result = (await handleGrexxToolCall(stub(fixture("PlannedLineResponse_V3")).client, "kpn_grexx_planned_line", {
      zipCode: "1012JS",
      houseNumber: 1,
      isRoomNumberKnown: true,
    })) as ToolResult;
    const body = JSON.parse(text(result));
    expect(body.data.PlannedLines.PlannedLine_V6.RoomNumber).toBe("1");
    expect(body.data.PlannedLines.PlannedLine_V6.TechnologyStatus).toBe("Open");
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
