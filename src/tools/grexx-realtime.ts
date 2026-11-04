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

export type GrexxFieldType = "string" | "integer" | "boolean" | "dateTime" | "integerList" | "decimal";

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
    /** decimal: XSD decimal value. */
    decimal?: boolean;
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
    tool: "kpn_grexx_mobile_total_usage",
    request: "GetMobileSubscriptionTotalUsageRequest_V1",
    response: "GetMobileSubscriptionTotalUsageResponse_V1",
    readOnly: true,
    description:
      "Total usage (data, voice, SMS and extra costs) per product for an IRMA customer " +
      "(GetMobileSubscriptionTotalUsageRequest_V1). Available from 5 minutes after activation.",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "IRMA customer ID, e.g. 28665." },
    ],
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
    tool: "kpn_grexx_voip_usage",
    request: "GetVoipUsageRequest_V1",
    response: "GetVoipUsageResponse_V1",
    readOnly: true,
    description:
      "Current usage (calls, amount and duration) for a VOIP order (GetVoipUsageRequest_V1). " +
      "Available from 5 minutes after activation.",
    fields: [
      orderId("the VOIP order"),
      { arg: "phoneNumber", element: "PhoneNumber", type: "string", required: true, pattern: /^\+\d{9,15}$/, description: 'VOIP phone number in E.164 format, e.g. "+31612345678".' },
    ],
  },
  {
    tool: "kpn_grexx_voip_total_usage",
    request: "GetVoipTotalUsageRequest_V1",
    response: "GetVoipTotalUsageResponse_V1",
    readOnly: true,
    description:
      "Total usage (calls, amount and duration) per VOIP phone number for an IRMA customer " +
      "(GetVoipTotalUsageRequest_V1).",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "IRMA customer ID, e.g. 28665." },
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
  {
    tool: "kpn_grexx_invoice_catalog",
    request: "CustomerInvoiceCatalogRequest_V1",
    response: "CustomerInvoiceCatalogResponse_V1",
    readOnly: true,
    description:
      "Invoice catalog for the last 12 months, including document metadata, for an IRMA customer " +
      "(CustomerInvoiceCatalogRequest_V1). Catalog only; invoice documents are not exposed.",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "IRMA customer ID, e.g. 28665." },
    ],
  },
  {
    tool: "kpn_grexx_microsoft_subscription_end_date",
    request: "MicrosoftProductOrderLineSubscriptionEndDateRequest_V1",
    response: "MicrosoftProductOrderLineSubscriptionEndDateResponse_V1",
    readOnly: true,
    description:
      "Microsoft 365 product subscription end date for an IRMA customer or order " +
      "(MicrosoftProductOrderLineSubscriptionEndDateRequest_V1). With an order ID, the specific " +
      "subscription is returned; without one, the first subscription for the customer and product.",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "IRMA customer ID, e.g. 28665." },
      { arg: "productId", element: "ProductId", type: "string", required: true, description: "IRMA product code for the Microsoft Office subscription." },
      { arg: "orderId", element: "OrderId", type: "integer", required: false, min: 1, max: 2147483647, description: "IRMA order ID of the Microsoft Office licence. Optional; omit to find the first subscription." },
    ],
  },
  {
    tool: "kpn_grexx_upgrade_info",
    request: "GetUpgradeInfoRequest_V1",
    response: "GetUpgradeInfoResponse_V1",
    readOnly: true,
    description:
      "Whether an IRMA order can be upgraded and which target products are available " +
      "(GetUpgradeInfoRequest_V1).",
    fields: [orderId("the order")],
  },
  {
    tool: "kpn_grexx_related_products",
    request: "RelatedProductsRequest_V1",
    response: "RelatedProductsResponse_V1",
    readOnly: true,
    description:
      "Related products for a customer and product, such as mobile subscription modules " +
      "(RelatedProductsRequest_V1).",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "IRMA customer ID, e.g. 28665." },
      { arg: "productCode", element: "ProductCode", type: "string", required: true, min: 1, max: 13, description: "IRMA product code of the parent order, e.g. a mobile subscription." },
    ],
  },
  {
    tool: "kpn_grexx_mobile_call_forwardings",
    request: "GetMobileCallForwardingsRequest_V1",
    response: "GetMobileCallForwardingsResponse_V1",
    readOnly: true,
    description:
      "Mobile call forwarding status for an IRMA mobile order (GetMobileCallForwardingsRequest_V1). " +
      "Returns unconditional, no-reply, busy, and unreachable call-forwarding state.",
    fields: [orderId("the mobile order")],
  },
  {
    tool: "kpn_grexx_mobile_preferences",
    request: "GetMobilePreferencesRequest_V1",
    response: "GetMobilePreferencesResponse_V1",
    readOnly: true,
    description:
      "Mobile call-preference settings for an IRMA mobile order (GetMobilePreferencesRequest_V1). " +
      "Returns roaming, usage-notification, SIM-block, and related preference state.",
    fields: [orderId("the mobile order")],
  },
  {
    tool: "kpn_grexx_mobile_module",
    request: "GetMobileModuleRequest_V1",
    response: "GetMobileModuleResponse_V1",
    readOnly: true,
    description:
      "Mobile module status for an IRMA mobile order (GetMobileModuleRequest_V1). " +
      "Returns whether the requested mobile module is enabled or pending.",
    fields: [orderId("the mobile order")],
  },
  {
    tool: "kpn_grexx_planned_line",
    request: "PlannedLineRequest_V3",
    response: "PlannedLineResponse_V3",
    readOnly: true,
    description:
      "Planned line details for a Dutch address and room (PlannedLineRequest_V3). " +
      "Returns fibre and copper planning, delivery, technology, and connection status.",
    fields: [
      { arg: "zipCode", element: "ZipCode", type: "string", postcode: true, description: "Dutch postcode, e.g. 1012JS. Optional." },
      { arg: "houseNumber", element: "HouseNr", type: "integer", required: true, min: 1, description: "House number, e.g. 12." },
      { arg: "houseNumberExtension", element: "HouseNrExtension", type: "string", description: "House number addition. Optional." },
      { arg: "roomNumber", element: "RoomNumber", type: "string", description: "Room number. Optional." },
      { arg: "isRoomNumberKnown", element: "IsRoomNumberKnown", type: "boolean", required: true, description: "XSD IsRoomNumberKnown. Required. False when the room number is not known." },
    ],
  },
  {
    tool: "kpn_grexx_hip_number_orders",
    request: "GetHipPhoneNumberOrdersRequest_V1",
    response: "GetHipPhoneNumberOrdersResponse_V1",
    readOnly: true,
    description:
      "Order information for one or more HIP phone numbers on an IRMA customer card " +
      "(GetHipPhoneNumberOrdersRequest_V1). Up to 50 order IDs per call.",
    fields: [
      { arg: "orderIds", element: "OrderIds", type: "integerList", item: "OrderId", required: true, min: 1, max: 50, description: "IRMA order IDs of the HIP phone numbers (1-50)." },
    ],
  },
  {
    tool: "kpn_grexx_clean_internet_info",
    request: "GetCleanInternetInfoRequest_V1",
    response: "GetCleanInternetInfoResponse_V1",
    readOnly: true,
    description:
      "Whether Extra Safe Internet is active for an IRMA order (GetCleanInternetInfoRequest_V1).",
    fields: [orderId("the Extra Safe Internet order")],
  },
  {
    tool: "kpn_grexx_cloud_tenant",
    request: "CloudTenantRequest_V2",
    response: "CloudTenantResponse_V2",
    readOnly: true,
    description:
      "Microsoft cloud tenant information for an IRMA customer (CloudTenantRequest_V2). " +
      "The tenant is created once when the first cloud license order is placed.",
    fields: [{ arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "IRMA customer ID, e.g. 28665." }],
  },
  {
    tool: "kpn_grexx_microsoft_tenant_exists",
    request: "MicrosoftTenantExistsCheckRequest_V1",
    response: "MicrosoftTenantExistsCheckResponse_V1",
    readOnly: true,
    description:
      "Whether a Microsoft tenant exists (MicrosoftTenantExistsCheckRequest_V1). " +
      "Tenant names use the `tenant.onmicrosoft.com` form.",
    fields: [
      { arg: "tenantName", element: "TenantName", type: "string", required: true, pattern: /^[a-zA-Z0-9._-]{1,27}\.onmicrosoft\.com$/, description: "Microsoft tenant name, e.g. \"uwdomein.onmicrosoft.com\"." },
    ],
  },
  {
    tool: "kpn_grexx_microsoft_domain_ownership",
    request: "MicrosoftTenantDomainOwnershipCheckRequest_V1",
    response: "MicrosoftTenantDomainOwnershipCheckResponse_V1",
    readOnly: true,
    description:
      "Whether an IRMA customer has delegated access to a Microsoft tenant and whether the tenant is ready for onboarding " +
      "(MicrosoftTenantDomainOwnershipCheckRequest_V1).",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "IRMA customer ID, e.g. 28665." },
      { arg: "tenantId", element: "TenantId", type: "string", required: true, pattern: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, description: "Microsoft tenant ID (UUID)." },
    ],
  },
  {
    tool: "kpn_grexx_custom_price",
    request: "CustomPriceRequest_V1",
    response: "CustomPriceResponse_V1",
    readOnly: true,
    description:
      "Accepted or rejected custom (maatwerk) pricing for an IRMA order (CustomPriceRequest_V1). " +
      "This is a pricing lookup; it does not submit the pricing decision.",
    fields: [
      { arg: "orderId", element: "OrderId", type: "integer", required: true, min: 1, description: "IRMA order ID for which custom pricing was accepted or rejected." },
      { arg: "confirmationState", element: "ConfirmationState", type: "string", required: true, enum: ["Accepted", "Rejected"], description: "Whether KPN accepted or rejected the custom price." },
      { arg: "remark", element: "Remark", type: "string", description: "Optional pricing decision remark." },
      { arg: "price", element: "Price", type: "decimal", required: false, description: "Proposed custom price. Optional." },
      { arg: "setupPrice", element: "SetupPrice", type: "decimal", required: false, description: "Proposed custom setup price. Optional." },
      { arg: "terminationPrice", element: "TerminationPrice", type: "decimal", required: false, description: "Proposed custom termination price. Optional." },
    ],
  },
];

function fieldSchema(field: GrexxField): Record<string, unknown> {
  const description = field.description;
  switch (field.type) {
    case "integer":
      return { type: "integer", description, ...(field.min !== undefined ? { minimum: field.min } : {}), ...(field.max !== undefined ? { maximum: field.max } : {}) };
    case "boolean":
      return { type: "boolean", description };
    case "string":
      return {
        type: "string",
        description,
        ...(field.min !== undefined ? { minLength: field.min } : {}),
        ...(field.max !== undefined ? { maxLength: field.max } : {}),
        ...(field.enum ? { enum: [...field.enum] } : {}),
        ...(field.postcode ? undefined : field.pattern ? { pattern: field.pattern.source } : {}),
      };
    case "dateTime":
      return { type: "string", format: "date-time", description };
    case "integerList":
      return { type: "array", description, items: { type: "integer", minimum: 1 }, minItems: field.min, maxItems: field.max };
    case "decimal":
      return { type: "number", description, ...(field.min !== undefined ? { minimum: field.min } : {}), ...(field.max !== undefined ? { maximum: field.max } : {}) };
    default: {
      return { type: "string", description };
    }
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
