/**
 * Grexx / IRMA realtime calls described as data.
 *
 * Each spec lists its XSD request fields in XSD order: IRMA validates
 * `xs:sequence` order, so a field out of place is a 109 XML validation error.
 * Field names, types, limits and enums are copied from the request XSDs
 * (portal Webservice Beschrijvingen, export 2026-10-05). Tools and the
 * generic handler (handlers/grexx-realtime.ts) are both built from these specs.
 * Calls with a node-kpn builder (ZipCodeCheck, Prequalification, OrderData)
 * live in grexx.ts instead.
 */
import type { Tool } from "@modelcontextprotocol/server";

export type GrexxFieldType = "string" | "integer" | "boolean" | "dateTime" | "integerList";

export interface GrexxField {
  /** Tool argument name. */
  arg: string;
  /** XSD element name (sent as-is). */
  element: string;
  type: GrexxFieldType;
  description: string;
  required?: boolean;
  enum?: readonly string[];
  /** Strings: full-match pattern, checked after trimming. */
  pattern?: RegExp;
  /** Strings: remove spaces and upper-case (Dutch postcodes). */
  postcode?: boolean;
  /** Integers: inclusive bounds. Lists: item count bounds. */
  min?: number;
  max?: number;
  /** integerList: XSD item element name (`OrderId`). */
  item?: string;
}

export interface GrexxRealtimeSpec {
  tool: string;
  /** Request root element. */
  request: string;
  /** Response root element per the XSD. */
  response: string;
  description: string;
  fields: GrexxField[];
  /** Cross-field rule; return an error message when the arguments are invalid. */
  check?: (args: Record<string, unknown>) => string | undefined;
  /** False for calls that start work at KPN (not retried, not read-only). */
  readOnly?: boolean;
}

const orderId = (what: string): GrexxField => ({
  arg: "orderId",
  element: "OrderId",
  type: "integer",
  required: true,
  min: 1,
  description: `IRMA order ID of ${what}.`,
});

const has = (args: Record<string, unknown>, key: string) =>
  args[key] !== undefined && args[key] !== null && args[key] !== "";

const ORDER_STATES = [
  "Activate", "Activating", "Active", "Update", "Updating", "Terminate", "Terminating",
  "Terminated", "Cancelled", "Rejected", "ActionRequired", "PendingParent", "WaitForInvoicing",
  "Invoicing", "InvoicingCompleted", "UpdateActionRequired", "Completed",
] as const;

const PRODUCT_GROUPS = [
  "Connectivity", "Security", "Storage", "Internet", "Voip", "Additional", "Mobile", "Cloud", "Services247",
] as const;

const CUSTOMER_ORDER_BY = [
  "Id", "Name", "Street", "ZipCode", "City", "Phone1", "Phone2", "DateCreated", "IsActive",
  "ExternalId", "DebitNr", "FirstBillingDate",
] as const;

const CARRIER_PRODUCT_TYPES = ["xDSL", "FttH", "WeasFiber", "All"] as const;

const LINE_DIAGNOSE_SYMPTOMS = ["Sym103", "Sym104", "Sym105", "Sym111"] as const;

export const GREXX_REALTIME_SPECS: GrexxRealtimeSpec[] = [
  // Connectivity
  {
    tool: "kpn_grexx_carrier_info",
    request: "CarrierInfoRequest_V1",
    response: "CarrierInfoResponse_V1",
    description:
      "Infrastructure (carrier) information at a Dutch address for xDSL, FttH or WEAS fiber " +
      "(IRMA CarrierInfoRequest_V1): connection points, line details and planned work.",
    fields: [
      { arg: "productType", element: "ProductType", type: "string", required: true, enum: CARRIER_PRODUCT_TYPES, description: "xDSL, FttH, WeasFiber, or All." },
      { arg: "zipCode", element: "ZipCode", type: "string", required: true, postcode: true, pattern: /^\d{4}[A-Z]{2}$/, description: 'Dutch postcode, e.g. "1012JS".' },
      { arg: "houseNumber", element: "HouseNumber", type: "integer", required: true, min: 1, max: 99999, description: "House number, 1-99999." },
      { arg: "houseNumberExtension", element: "HouseNumberExt", type: "string", pattern: /^.{0,4}$/, description: "House number addition, up to 4 characters." },
      { arg: "phoneNumber", element: "PhoneNumber", type: "string", pattern: /^0\d{9}$/, description: 'Phone number, 10 digits starting with 0. xDSL only.' },
      { arg: "israSpecification", element: "IsraSpecification", type: "string", pattern: /^\d{3}$/, description: 'ISRA point, 3 digits, e.g. "001". xDSL only.' },
      { arg: "serviceId", element: "ServiceId", type: "string", description: "KPN service ID. xDSL only." },
    ],
  },
  {
    tool: "kpn_grexx_radius_check",
    request: "RadiusCheckRequest_V1",
    response: "RadiusCheckResponse_V1",
    description:
      "RADIUS login history of the modem/CPE on a connectivity order for the last 7 days (IRMA RadiusCheckRequest_V1). " +
      "Many logins suggest a flapping line. An empty result means the line has been up for over 7 days or not at all.",
    fields: [orderId("the connectivity order")],
  },
  {
    tool: "kpn_grexx_ras_check",
    request: "RasCheckRequest_V1",
    response: "RasCheckResponse_V1",
    description:
      "PPP/RAS session check on a connectivity order (IRMA RasCheckRequest_V1): whether a PPP session is up " +
      "and which IP address the connection has.",
    fields: [orderId("the connectivity order")],
  },
  {
    tool: "kpn_grexx_start_line_diagnose",
    request: "StartLineDiagnoseRequest_V1",
    response: "StartLineDiagnoseResponse_V1",
    readOnly: false,
    description:
      "Start a KPN line diagnose on an xDSL (Ethernet) order (IRMA StartLineDiagnoseRequest_V1). " +
      "Use it when a line is out of sync. This starts a test at KPN; it is not retried automatically. " +
      "The response confirms the start and returns an AnalysisId. Fetching the result (GetLatest) is not exposed yet.",
    fields: [
      orderId("the xDSL order"),
      { arg: "symptomCode", element: "SymptomCode", type: "string", required: true, enum: LINE_DIAGNOSE_SYMPTOMS, description: "IRMA symptom code: Sym103, Sym104, Sym105, or Sym111." },
    ],
  },
  // Generic / CRM
  {
    tool: "kpn_grexx_customer_data",
    request: "CustomerDataRequest_V1",
    response: "CustomerDataResponse_V1",
    description:
      "Search IRMA customer cards (CustomerDataRequest_V1). With no filters it pages through every customer. " +
      "Returns PagedResult with TotalNumberOfRecords. Take is at most 100 (default 20).",
    fields: [
      { arg: "customerId", element: "Id", type: "integer", min: 1, description: "IRMA customer ID, e.g. 28665." },
      { arg: "name", element: "Name", type: "string", description: "Customer name." },
      { arg: "street", element: "Street", type: "string", description: "Street name." },
      { arg: "zipCode", element: "ZipCode", type: "string", postcode: true, description: 'Postcode, e.g. "6716BX".' },
      { arg: "city", element: "City", type: "string", description: "City." },
      { arg: "countryCode", element: "CountryCode", type: "string", enum: ["BEL", "DEU", "FRA", "NLD"], description: "BEL, DEU, FRA, or NLD." },
      { arg: "phone1", element: "Phone1", type: "string", description: "First phone number." },
      { arg: "phone2", element: "Phone2", type: "string", description: "Second phone number (e.g. mobile)." },
      { arg: "debitNumber", element: "DebitNr", type: "string", description: "Debtor number." },
      { arg: "externalId", element: "ExternalId", type: "string", description: "External ID." },
      { arg: "chamberOfCommerceNumber", element: "ChamberOfCommerceNr", type: "string", description: "KvK (Chamber of Commerce) number." },
      { arg: "vatNumber", element: "VATNr", type: "string", description: "VAT number, e.g. NL123456." },
      { arg: "includeInactiveCustomers", element: "IncludeInactiveCustomers", type: "boolean", description: "Also return inactive customers. Default: active only." },
      { arg: "orderBy", element: "OrderByMember", type: "string", enum: CUSTOMER_ORDER_BY, description: "Sort field. Default Id." },
      { arg: "orderByDescending", element: "OrderByDescending", type: "boolean", description: "Sort descending. Default ascending." },
      { arg: "skip", element: "Skip", type: "integer", min: 0, description: "Records to skip (paging). Default 0." },
      { arg: "take", element: "Take", type: "integer", min: 1, max: 100, description: "Records to return, 1-100. Default 20." },
    ],
  },
  {
    tool: "kpn_grexx_order_summary",
    request: "OrderSummaryRequest_V1",
    response: "OrderSummaryResponse_V1",
    description:
      "Summary of orders (IRMA OrderSummaryRequest_V1), optionally for one customer card and filtered by state, " +
      "product group, product, dates, label or attribute (e.g. a phone number). Take is at most 2500; page with skip.",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", min: 1, description: "IRMA customer card ID." },
      { arg: "orderState", element: "OrderState", type: "string", enum: ORDER_STATES, description: "Only orders in this state." },
      { arg: "productGroup", element: "ProductGroup", type: "string", enum: PRODUCT_GROUPS, description: "Only orders in this product group." },
      { arg: "productName", element: "ProductName", type: "string", description: "Only orders for this product name." },
      { arg: "dateActiveFrom", element: "DateActiveFrom", type: "dateTime", description: "xs:dateTime with a time, e.g. \"2025-01-01T00:00:00Z\". Orders active from this moment." },
      { arg: "dateActiveTo", element: "DateActiveTo", type: "dateTime", description: "xs:dateTime with a time, e.g. \"2025-01-01T00:00:00Z\". Orders active before this moment." },
      { arg: "dateModifiedFrom", element: "DateModifiedFrom", type: "dateTime", description: "xs:dateTime with a time, e.g. \"2025-01-01T00:00:00Z\". Orders modified from this moment." },
      { arg: "dateModifiedTo", element: "DateModifiedTo", type: "dateTime", description: "xs:dateTime with a time, e.g. \"2025-01-01T00:00:00Z\". Orders modified before this moment." },
      { arg: "label", element: "Label", type: "string", description: "Text contained in the order label." },
      { arg: "attribute", element: "Attribute", type: "string", description: "Text contained in the order attribute (e.g. a phone number)." },
      { arg: "skip", element: "Skip", type: "integer", min: 0, description: "Orders to skip (paging)." },
      { arg: "take", element: "Take", type: "integer", min: 1, max: 2500, description: "Orders to return, 1-2500." },
    ],
  },
  // Mobile
  {
    tool: "kpn_grexx_get_sim",
    request: "GetSimRequest_V1",
    response: "GetSimResponse_V1",
    description:
      "Active SIM card (or eSIM) on an active mobile order (IRMA GetSimRequest_V1): ICCID and SIM type. " +
      "The PUK (Puc1) and eSIM activation and confirmation codes are masked.",
    fields: [orderId("the mobile order")],
  },
  {
    tool: "kpn_grexx_mobile_settings",
    request: "GetMobileSettingsRequest_V1",
    response: "GetMobileSettingsResponse_V1",
    description:
      "Blocks and limits on a mobile number (IRMA GetMobileSettingsRequest_V1). Available from 5 minutes after activation.",
    fields: [orderId("the mobile number's order")],
  },
  {
    tool: "kpn_grexx_mobile_usage",
    request: "GetMobileSubscriptionUsageRequest_V1",
    response: "GetMobileSubscriptionUsageResponse_V1",
    description:
      "Current usage (data, voice, SMS) of a mobile number (IRMA GetMobileSubscriptionUsageRequest_V1). " +
      "Available from 5 minutes after activation.",
    fields: [orderId("the mobile number's order")],
  },
  {
    tool: "kpn_grexx_mobile_orders",
    request: "GetMobileSubscriptionOrdersRequest_V1",
    response: "GetMobileSubscriptionOrdersResponse_V1",
    description:
      "Order data for 1-50 mobile subscription orders (IRMA GetMobileSubscriptionOrdersRequest_V1): " +
      "number, SIM, subscription and bundles.",
    fields: [
      { arg: "orderIds", element: "OrderIds", type: "integerList", item: "OrderId", required: true, min: 1, max: 50, description: "IRMA order IDs of the mobile orders (1-50)." },
    ],
  },
  {
    tool: "kpn_grexx_available_portings",
    request: "AvailablePortingsRequest_V1",
    response: "AvailablePortingsResponse_V1",
    description:
      "Number portings available for every mobile subscription of an IRMA customer, or for every number of a " +
      "HIP group / HIP Express Office / KPN EEN switchboard order (IRMA AvailablePortingsRequest_V1). Pass exactly one ID.",
    fields: [
      // Element name is misspelled in the XSD ("Subscripion"); IRMA expects it as written.
      { arg: "customerId", element: "MobileSubscripionCustomerId", type: "integer", min: 1, description: "IRMA customer ID (mobile subscriptions)." },
      { arg: "hipGroupOrderId", element: "HipGroupOrderId", type: "integer", min: 1, description: "Order ID of a HIP group / HIP Express Office / KPN EEN switchboard." },
    ],
    check: (args) =>
      has(args, "customerId") === has(args, "hipGroupOrderId")
        ? 'Pass exactly one of "customerId" or "hipGroupOrderId".'
        : undefined,
  },
];

function fieldSchema(field: GrexxField): Record<string, unknown> {
  const description = field.description;
  switch (field.type) {
    case "integer":
      return { type: "integer", description, ...(field.min !== undefined ? { minimum: field.min } : {}), ...(field.max !== undefined ? { maximum: field.max } : {}) };
    case "boolean":
      return { type: "boolean", description };
    case "dateTime":
      return { type: "string", format: "date-time", description };
    case "integerList":
      return { type: "array", description, items: { type: "integer", minimum: 1 }, minItems: field.min, maxItems: field.max };
    default:
      return { type: "string", description, ...(field.enum ? { enum: [...field.enum] } : {}) };
  }
}

/** Build the MCP tool definition for a spec. */
export function realtimeTool(spec: GrexxRealtimeSpec): Tool {
  const readOnly = spec.readOnly !== false;
  return {
    name: spec.tool,
    description: spec.description,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        spec.fields.map((field) => [field.arg, fieldSchema(field)])
      ) as NonNullable<Tool["inputSchema"]["properties"]>,
      ...(spec.fields.some((field) => field.required)
        ? { required: spec.fields.filter((field) => field.required).map((field) => field.arg) }
        : {}),
    },
    annotations: readOnly
      ? { readOnlyHint: true, openWorldHint: true, idempotentHint: true }
      : { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  };
}

export const GREXX_REALTIME_TOOLS: Tool[] = GREXX_REALTIME_SPECS.map(realtimeTool);
