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
import { CONFIRM_ARG_PROPERTY } from "../elicitation.js";

export type GrexxFieldType =
  | "string"
  | "integer"
  | "boolean"
  | "dateTime"
  | "integerList"
  | "decimal"
  | "object"
  | "stringList";

export interface GrexxField {
  /** Tool argument name. */
  arg: string;
  /** XSD element name (sent as-is). */
  element: string;
  type: GrexxFieldType;
  description: string;
  required?: boolean;
  /** Human-readable field label for validation messages. */
  label?: string;
  enum?: readonly string[];
  /** Calm, field-specific format guidance for validation messages. */
  formatHint?: string;
  /** Strings: full-match pattern, checked after trimming. */
  pattern?: RegExp;
  /** Strings: remove spaces and upper-case (Dutch postcodes). */
  postcode?: boolean;
  /** Integers: inclusive bounds. Lists: item count bounds. */
  min?: number;
  max?: number;
  /** integerList: XSD item element name (`OrderId`). */
  item?: string;
  /** Nested object fields, in XSD child-element order. */
  fields?: readonly GrexxField[];
  /** Filled in by the server (not an input argument), e.g. a request header. */
  generated?: boolean;
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
  /** Off by default for destructive/admin tools; writes use the confirm gate. */
  admin?: boolean;
  /** Require interactive or explicit confirmation before one mutating call. */
  confirm?: boolean;
  /** High-impact writes use destructive annotations and the confirmation gate. */
  destructive?: boolean;
}

const orderId = (what: string): GrexxField => ({
  arg: "orderId",
  element: "OrderId",
  type: "integer",
  required: true,
  min: 1,
  description: `KPN order number (IRMA order ID) of ${what}.`,
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

const CONTACT_SYSTEM_NOTIFICATIONS = [
  "Primary", "Management", "Financial", "Technical", "Commercial", "HelpDesk247", "Security",
  "OrderStatusUpdates", "AntiDdos", "ProActiveFiberNotifications", "HighUsageNotifications",
] as const;

const CONTACT_NEWS_NOTIFICATIONS = ["RoutITSales", "RoutITCommercial", "RoutITTechnical", "RoutITFinancial"] as const;

const CONTACT_THRESHOLD_ALERTS = [
  "CustomerVoipBlockingLimit", "PartnerVoipWarningLimit", "CustomerVoipWarningLimit",
  "CustomerMobileHighUsage", "PartnerMobileHighUsage", "PartnerEsimUnblock", "PartnerM2MHighUsage",
] as const;
/** Grexx realtime tools that submit a request rather than return data. */
export function isGrexxWriteTool(name: string): boolean {
  return GREXX_REALTIME_SPECS.some((spec) => spec.tool === name && spec.readOnly === false);
}

const E164 = /^\+\d{9,15}$/;
const E164_HINT = "Phone number must be in international format, e.g. +31612345678 (plus sign, country code, no spaces). Replace the leading 0 with +31.";
const MAC = /^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{12}$/;
/** Letters, digits, "-" and "_" only (XSD documentation for DeviceUserName and LinePort). */
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

const notificationPreferences = (): GrexxField => ({
  arg: "notificationPreferences",
  element: "NotificationPreferences",
  type: "object",
  label: "Notification settings",
  description: "Which KPN notifications this contact receives. Optional.",
  fields: [
    { arg: "enabledSystemNotifications", element: "EnabledSystemNotifications", type: "stringList", enum: CONTACT_SYSTEM_NOTIFICATIONS, label: "System notifications", description: "KPN service and outage notifications this contact receives." },
    { arg: "enabledNewsNotifications", element: "EnabledNewsNotifications", type: "stringList", enum: CONTACT_NEWS_NOTIFICATIONS, label: "News notifications", description: "KPN news notifications this contact receives." },
    { arg: "enabledThresholdAlerts", element: "EnabledThresholdAlerts", type: "stringList", enum: CONTACT_THRESHOLD_ALERTS, label: "Usage alerts", description: "Usage-limit alerts this contact receives (e.g. when a bundle is nearly used up)." },
  ],
});

const contactDetails = (description: string, phone1Required = false): GrexxField => ({
  arg: "contactPostPutRequest",
  element: "ContactPostPutRequest",
  type: "object",
  required: true,
  label: "Contact details",
  description,
  fields: [
    { arg: "displayName", element: "DisplayName", type: "string", required: true, label: "Name", description: "Contact person's name as shown at KPN, e.g. Jan Jansen." },
    { arg: "email", element: "Email", type: "string", required: true, label: "Email", description: "Contact person's email address." },
    { arg: "phone1", element: "Phone1", type: "string", required: phone1Required, label: "Phone 1", description: phone1Required ? "Main phone number." : "Main phone number. Optional." },
    { arg: "phone2", element: "Phone2", type: "string", label: "Phone 2", description: "Second phone number. Optional." },
    notificationPreferences(),
  ],
});

export const GREXX_REALTIME_SPECS: GrexxRealtimeSpec[] = [
  // Connectivity
  {
    tool: "kpn_grexx_carrier_info",
    request: "CarrierInfoRequest_V1",
    response: "CarrierInfoResponse_V1",
    description:
      "Get carrier information for a Dutch address. Read-only. Includes connection points, " +
      "line details and planned work. (Grexx: CarrierInfoRequest_V1)",
    fields: [
      { arg: "productType", element: "ProductType", type: "string", required: true, enum: CARRIER_PRODUCT_TYPES, description: "xDSL, FttH, WeasFiber, or All." },
      { arg: "zipCode", element: "ZipCode", type: "string", required: true, postcode: true, pattern: /^\d{4}[A-Z]{2}$/, label: "Postcode", formatHint: "Postcode must look like 1234AB: four digits, then two letters.", description: 'Dutch postcode: four digits and two letters, with or without a space, e.g. "1012 JS" or "1012JS".' },
      { arg: "houseNumber", element: "HouseNumber", type: "integer", required: true, min: 1, max: 99999, label: "House number", description: "House number, 1-99999." },
      { arg: "houseNumberExtension", element: "HouseNumberExt", type: "string", pattern: /^.{0,4}$/, label: "House number addition", formatHint: "House number addition can be at most 4 characters, e.g. A or bis.", description: "House number addition (toevoeging), up to 4 characters, e.g. A or bis." },
      { arg: "phoneNumber", element: "PhoneNumber", type: "string", pattern: /^0\d{9}$/, label: "Phone number", formatHint: "Phone number must be 10 digits starting with 0, e.g. 0201234567.", description: "Phone number, 10 digits starting with 0, e.g. 0201234567. xDSL only." },
      { arg: "israSpecification", element: "IsraSpecification", type: "string", pattern: /^\d{3}$/, label: "ISRA point", formatHint: "ISRA point must be 3 digits, e.g. 001.", description: 'ISRA point, 3 digits, e.g. "001". xDSL only.' },
      { arg: "serviceId", element: "ServiceId", type: "string", label: "KPN service ID", description: "KPN service ID. xDSL only." },
    ],
  },
  {
    tool: "kpn_grexx_radius_check",
    request: "RadiusCheckRequest_V1",
    response: "RadiusCheckResponse_V1",
    description:
      "Get RADIUS login history for a connectivity order. Read-only. Looks at the last 7 days " +
      "and may suggest checking a line that is flapping. An empty result means the line has been up " +
      "for over 7 days or not at all. (Grexx: RadiusCheckRequest_V1)",
    fields: [orderId("the connectivity order")],
  },
  {
    tool: "kpn_grexx_ras_check",
    request: "RasCheckRequest_V1",
    response: "RasCheckResponse_V1",
    description:
      "Get the PPP/RAS session state for a connectivity order. Read-only. Shows whether the session " +
      "is up and which IP address the connection has. (Grexx: RasCheckRequest_V1)",
    fields: [orderId("the connectivity order")],
  },
  {
    tool: "kpn_grexx_start_line_diagnose",
    request: "StartLineDiagnoseRequest_V1",
    response: "StartLineDiagnoseResponse_V1",
    readOnly: false,
    description:
      "Starts a KPN line diagnose on an xDSL (Ethernet) order. Use it when a line is out of sync. " +
      "This starts a test at KPN; it is not retried automatically. The response confirms the start and " +
      "returns an AnalysisId. Fetching the result (GetLatest) is not exposed yet. (Grexx: StartLineDiagnoseRequest_V1)",
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
      "Search customer data for a KPN customer. Read-only. With no filters it pages through every " +
      "customer; take is at most 100 (default 20). (Grexx: CustomerDataRequest_V1)",
    fields: [
      { arg: "customerId", element: "Id", type: "integer", min: 1, description: "KPN customer number (IRMA customer ID), e.g. 28665." },
      { arg: "name", element: "Name", type: "string", description: "Customer name." },
      { arg: "street", element: "Street", type: "string", description: "Street name." },
      { arg: "zipCode", element: "ZipCode", type: "string", postcode: true, label: "Postcode", formatHint: "Postcode must look like 1234AB: four digits, then two letters.", description: 'Dutch postcode: four digits and two letters, with or without a space, e.g. "1012 JS" or "1012JS".' },
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
      "Summarize orders for a KPN customer. Read-only. Optionally filter by state, product group, " +
      "product, dates, label or attribute (e.g. a phone number); take is at most 2500 and pages with skip. " +
      "(Grexx: OrderSummaryRequest_V1)",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", min: 1, description: "KPN customer number (IRMA customer ID), e.g. 28665." },
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
      "Get the active SIM card or eSIM for a mobile order. Read-only. Returns the ICCID and SIM type; " +
      "the PUK and eSIM activation and confirmation codes are masked. (Grexx: GetSimRequest_V1)",
    fields: [orderId("the mobile order")],
  },
  {
    tool: "kpn_grexx_mobile_settings",
    request: "GetMobileSettingsRequest_V1",
    response: "GetMobileSettingsResponse_V1",
    description:
      "Get blocks and limits for a mobile number. Read-only. Available from 5 minutes after activation. " +
      "(Grexx: GetMobileSettingsRequest_V1)",
    fields: [orderId("the mobile number's order")],
  },
  {
    tool: "kpn_grexx_mobile_usage",
    request: "GetMobileSubscriptionUsageRequest_V1",
    response: "GetMobileSubscriptionUsageResponse_V1",
    description:
      "Get current usage for a mobile number. Read-only. Covers data, calls and SMS; available from " +
      "5 minutes after activation. (Grexx: GetMobileSubscriptionUsageRequest_V1)",
    fields: [orderId("the mobile number's order")],
  },
  {
    tool: "kpn_grexx_mobile_total_usage",
    request: "GetMobileSubscriptionTotalUsageRequest_V1",
    response: "GetMobileSubscriptionTotalUsageResponse_V1",
    readOnly: true,
    description:
      "Get total mobile usage (data, calls, SMS and extra costs) per bundle for a KPN customer. " +
      "Read-only. Data appears about 5 minutes after a line is activated. " +
      "(Grexx: GetMobileSubscriptionTotalUsageRequest_V1)",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "KPN customer number (IRMA customer ID), e.g. 28665." },
    ],
  },
  {
    tool: "kpn_grexx_mobile_orders",
    request: "GetMobileSubscriptionOrdersRequest_V1",
    response: "GetMobileSubscriptionOrdersResponse_V1",
    description:
      "Get mobile subscription orders. Read-only. Returns the number, SIM, subscription and bundle " +
      "details for up to 50 orders. (Grexx: GetMobileSubscriptionOrdersRequest_V1)",
    fields: [
      { arg: "orderIds", element: "OrderIds", type: "integerList", item: "OrderId", required: true, min: 1, max: 50, description: "KPN order numbers (IRMA order IDs) of the mobile orders (1-50)." },
    ],
  },
  {
    tool: "kpn_grexx_voip_usage",
    request: "GetVoipUsageRequest_V1",
    response: "GetVoipUsageResponse_V1",
    readOnly: true,
    description:
      "Get current-period VoIP call usage (number of calls, cost and duration) for one KPN VoIP order. " +
      "Read-only. Data appears about 5 minutes after activation. " +
      "(Grexx: GetVoipUsageRequest_V1)",
    fields: [
      orderId("the VoIP order"),
      { arg: "phoneNumber", element: "PhoneNumber", type: "string", required: true, pattern: /^\+\d{9,15}$/, label: "Phone number", formatHint: "Phone number must be in international format, e.g. +31612345678 (plus sign, country code, no spaces). Replace the leading 0 with +31.", description: 'VoIP phone number in international format: plus sign, country code, no spaces or leading 0, e.g. "+31201234567".' },
    ],
  },
  {
    tool: "kpn_grexx_voip_total_usage",
    request: "GetVoipTotalUsageRequest_V1",
    response: "GetVoipTotalUsageResponse_V1",
    readOnly: true,
    description:
      "Get total VoIP call usage (number of calls, cost and duration) per phone number for a KPN customer. " +
      "Read-only. (Grexx: GetVoipTotalUsageRequest_V1)",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "KPN customer number (IRMA customer ID), e.g. 28665." },
    ],
  },
  {
    tool: "kpn_grexx_available_portings",
    request: "AvailablePortingsRequest_V1",
    response: "AvailablePortingsResponse_V1",
    description:
      "List portings available for a KPN customer or VoIP number. Read-only. Pass exactly one customer ID " +
      "or HIP group order ID. (Grexx: AvailablePortingsRequest_V1)",
    fields: [
      // Element name is misspelled in the XSD ("Subscripion"); IRMA expects it as written.
      { arg: "customerId", element: "MobileSubscripionCustomerId", type: "integer", min: 1, description: "KPN customer number (IRMA customer ID) for mobile subscriptions." },
      { arg: "hipGroupOrderId", element: "HipGroupOrderId", type: "integer", min: 1, description: "KPN order number (IRMA order ID) for a HIP group / HIP Express Office / KPN EEN switchboard." },
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
      "List a KPN customer's invoices from the last 12 months (invoice number, date, amount and document " +
      "details). Read-only. Doesn't return the invoice PDFs. (Grexx: CustomerInvoiceCatalogRequest_V1)",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "KPN customer number (IRMA customer ID), e.g. 28665." },
    ],
  },
  {
    tool: "kpn_grexx_microsoft_subscription_end_date",
    request: "MicrosoftProductOrderLineSubscriptionEndDateRequest_V1",
    response: "MicrosoftProductOrderLineSubscriptionEndDateResponse_V1",
    readOnly: true,
    description:
      "Get the end (renewal) date of a customer's Microsoft 365 subscription bought through KPN. Read-only. " +
      "If you pass an order number you get that subscription. Without one you get the first matching " +
      "subscription, which may not be the one you want when the customer has several. " +
      "(Grexx: MicrosoftProductOrderLineSubscriptionEndDateRequest_V1)",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "KPN customer number (IRMA customer ID), e.g. 28665." },
      { arg: "productId", element: "ProductId", type: "string", required: true, label: "Product code", description: "KPN product code of the Microsoft 365 subscription." },
      { arg: "orderId", element: "OrderId", type: "integer", required: false, min: 1, max: 2147483647, label: "Order number", description: "KPN order number of the Microsoft 365 subscription. Optional. Leave it empty to get the customer's first matching subscription." },
    ],
  },
  {
    tool: "kpn_grexx_upgrade_info",
    request: "GetUpgradeInfoRequest_V1",
    response: "GetUpgradeInfoResponse_V1",
    readOnly: true,
    description:
      "Check whether a KPN order can be upgraded and list the products it can move to. Read-only. " +
      "Doesn't place an upgrade. (Grexx: GetUpgradeInfoRequest_V1)",
    fields: [orderId("the order")],
  },
  {
    tool: "kpn_grexx_related_products",
    request: "RelatedProductsRequest_V1",
    response: "RelatedProductsResponse_V1",
    readOnly: true,
    description:
      "List add-ons and related products a KPN customer can add to a product, e.g. extra bundles for a " +
      "mobile subscription. Read-only. (Grexx: RelatedProductsRequest_V1)",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "KPN customer number (IRMA customer ID), e.g. 28665." },
      { arg: "productCode", element: "ProductCode", type: "string", required: true, min: 1, max: 13, label: "Product code", description: "KPN product code of the main product the add-ons belong to (up to 13 characters), e.g. a mobile subscription." },
    ],
  },
  {
    tool: "kpn_grexx_mobile_call_forwardings",
    request: "GetMobileCallForwardingsRequest_V1",
    response: "GetMobileCallForwardingsResponse_V1",
    readOnly: true,
    description:
      "Get the call-forwarding settings of a KPN mobile line: always, when not answered, when busy and " +
      "when unreachable. Read-only. (Grexx: GetMobileCallForwardingsRequest_V1)",
    fields: [orderId("the mobile order")],
  },
  {
    tool: "kpn_grexx_mobile_preferences",
    request: "GetMobilePreferencesRequest_V1",
    response: "GetMobilePreferencesResponse_V1",
    readOnly: true,
    description:
      "Get a KPN mobile line's settings: roaming (use abroad), usage alerts, SIM block and similar " +
      "preferences. Read-only. It doesn't change a SIM block. (Grexx: GetMobilePreferencesRequest_V1)",
    fields: [orderId("the mobile order")],
  },
  {
    tool: "kpn_grexx_mobile_module",
    request: "GetMobileModuleRequest_V1",
    response: "GetMobileModuleResponse_V1",
    readOnly: true,
    description:
      "Check whether an add-on (module, e.g. a data or roaming bundle) is active or pending on a KPN mobile " +
      "line. Read-only. The module is identified by its own order number (orderId), not the mobile line's. " +
      "(Grexx: GetMobileModuleRequest_V1)",
    fields: [orderId("the mobile module (add-on) order")],
  },
  {
    tool: "kpn_grexx_planned_line",
    request: "PlannedLineRequest_V3",
    response: "PlannedLineResponse_V3",
    readOnly: true,
    description:
      "Get planned and existing KPN internet line details for a Dutch address: fibre or copper, planned " +
      "delivery dates, technology and connection status. Read-only. Use it to check whether and when fibre " +
      "is coming to an address. (Grexx: PlannedLineRequest_V3)",
    fields: [
      { arg: "zipCode", element: "ZipCode", type: "string", postcode: true, pattern: /^\d{4}[A-Z]{2}$/, label: "Postcode", formatHint: "Postcode must look like 1234AB: four digits, then two letters.", description: "Dutch postcode: four digits and two letters, e.g. 1012JS. Optional, but strongly recommended: a house number alone may match several addresses." },
      { arg: "houseNumber", element: "HouseNr", type: "integer", required: true, min: 1, description: "House number, digits only, e.g. 12. Put any letter or suffix (A, bis, -1) in houseNumberExtension." },
      { arg: "houseNumberExtension", element: "HouseNrExtension", type: "string", description: "House number addition (toevoeging), e.g. A, bis or 3-hoog. Optional." },
      { arg: "roomNumber", element: "RoomNumber", type: "string", description: "Room or unit number inside the building, e.g. in an office complex or care home. Only needed when isRoomNumberKnown is true." },
      { arg: "isRoomNumberKnown", element: "IsRoomNumberKnown", type: "boolean", required: true, label: "Room number known", description: "Do you know the room number? Set true and fill in roomNumber, or set false if not (false is the usual value: most homes have no room number)." },
    ],
  },
  {
    tool: "kpn_grexx_hip_number_orders",
    request: "GetHipPhoneNumberOrdersRequest_V1",
    response: "GetHipPhoneNumberOrdersResponse_V1",
    readOnly: true,
    description:
      "Get order details for up to 50 KPN HIP phone numbers, e.g. number porting status. Read-only. " +
      "(Grexx: GetHipPhoneNumberOrdersRequest_V1)",
    fields: [
      { arg: "orderIds", element: "OrderIds", type: "integerList", item: "OrderId", required: true, min: 1, max: 50, label: "Order numbers", description: "KPN order numbers (IRMA order IDs) of the phone numbers to look up: 1 to 50 per call." },
    ],
  },
  {
    tool: "kpn_grexx_clean_internet_info",
    request: "GetCleanInternetInfoRequest_V1",
    response: "GetCleanInternetInfoResponse_V1",
    readOnly: true,
    description:
      "Check whether Extra Safe Internet (CleanInternet) is switched on for a KPN internet order. Read-only. " +
      "(Grexx: GetCleanInternetInfoRequest_V1)",
    fields: [orderId("the Extra Safe Internet order")],
  },
  {
    tool: "kpn_grexx_cloud_tenant",
    request: "CloudTenantRequest_V2",
    response: "CloudTenantResponse_V2",
    readOnly: true,
    description:
      "Get the Microsoft 365 tenant (the customer's Microsoft account environment) that KPN manages for a " +
      "customer. Read-only. A customer only has one after their first Microsoft 365 order. " +
      "(Grexx: CloudTenantRequest_V2)",
    fields: [{ arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "KPN customer number (IRMA customer ID), e.g. 28665." }],
  },
  {
    tool: "kpn_grexx_microsoft_tenant_exists",
    request: "MicrosoftTenantExistsCheckRequest_V1",
    response: "MicrosoftTenantExistsCheckResponse_V1",
    readOnly: true,
    description:
      "Check whether a Microsoft 365 tenant name is already taken, e.g. before ordering Microsoft 365. " +
      "Read-only. Use the yourcompany.onmicrosoft.com form. (Grexx: MicrosoftTenantExistsCheckRequest_V1)",
    fields: [
      { arg: "tenantName", element: "TenantName", type: "string", required: true, pattern: /^[a-zA-Z0-9._-]{1,27}\.onmicrosoft\.com$/, label: "Tenant name", formatHint: "Tenant name must end in .onmicrosoft.com, e.g. yourcompany.onmicrosoft.com.", description: "Microsoft 365 tenant name ending in .onmicrosoft.com, up to 27 characters before it, e.g. \"yourcompany.onmicrosoft.com\"." },
    ],
  },
  {
    tool: "kpn_grexx_microsoft_domain_ownership",
    request: "MicrosoftTenantDomainOwnershipCheckRequest_V1",
    response: "MicrosoftTenantDomainOwnershipCheckResponse_V1",
    readOnly: true,
    description:
      "Check whether KPN has been given admin access (delegated access) to a customer's existing Microsoft 365 " +
      "tenant, and whether it's ready to move to KPN. Read-only. (Grexx: MicrosoftTenantDomainOwnershipCheckRequest_V1)",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, description: "KPN customer number (IRMA customer ID), e.g. 28665." },
      { arg: "tenantId", element: "TenantId", type: "string", required: true, pattern: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, label: "Tenant ID", formatHint: "Tenant ID must be a 36-character ID like 1b2c3d4e-0000-1111-2222-333344445555. You can find it in the Microsoft 365 admin center.", description: "Microsoft 365 tenant ID: a 36-character ID like 1b2c3d4e-0000-1111-2222-333344445555. You can find it in the Microsoft 365 admin center." },
    ],
  },
  {
    tool: "kpn_grexx_custom_price",
    request: "CustomPriceRequest_V1",
    response: "CustomPriceResponse_V1",
    readOnly: false,
    destructive: true,
    confirm: true,
    description:
      "⚠ DESTRUCTIVE. Accepts or rejects a custom (maatwerk) price that KPN proposed on an order. " +
      "Submits your decision to KPN in one call and is not retried; it can't be undone through this tool. " +
      "Confirm with the user before invoking. (Grexx: CustomPriceRequest_V1)",
    fields: [
      { arg: "orderId", element: "OrderId", type: "integer", required: true, min: 1, label: "Order number", description: "KPN order number (IRMA order ID) the custom price applies to." },
      { arg: "confirmationState", element: "ConfirmationState", type: "string", required: true, enum: ["Accepted", "Rejected"], label: "Decision", description: "Your decision on KPN's proposed custom price: Accepted or Rejected." },
      { arg: "remark", element: "Remark", type: "string", description: "Remark sent with your decision. Optional." },
      { arg: "price", element: "Price", type: "decimal", required: false, description: "Custom price, e.g. 24.95. Optional." },
      { arg: "setupPrice", element: "SetupPrice", type: "decimal", required: false, label: "Setup price", description: "Custom one-time setup price, e.g. 0.00. Optional." },
      { arg: "terminationPrice", element: "TerminationPrice", type: "decimal", required: false, label: "Termination price", description: "Custom termination price, e.g. 0.00. Optional." },
    ],
  },
  {
    tool: "kpn_grexx_get_contact",
    request: "GetContactRequest_V1",
    response: "ContactResponse_V1",
    readOnly: true,
    description:
      "Get one contact person's details on a KPN customer's account: name, email, phone numbers and notification settings. " +
      "Read-only. (Grexx: GetContactRequest_V1)",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, label: "Customer number", description: "KPN customer number (IRMA customer ID), e.g. 28665." },
      { arg: "contactId", element: "ContactId", type: "integer", required: true, min: 1, label: "Contact ID", description: "KPN contact ID." },
    ],
  },
  {
    tool: "kpn_grexx_search_contacts",
    request: "GetContactsByCustomerIdAndSearchParametersRequest_V1",
    response: "ContactResponsePagingResult_V1",
    readOnly: true,
    description:
      "Search a KPN customer's contact people by name, email or phone, optionally filtered by which notifications they receive. " +
      "Read-only. Results are paged (offset, limit). (Grexx: GetContactsByCustomerIdAndSearchParametersRequest_V1)",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, label: "Customer number", description: "KPN customer number (IRMA customer ID), e.g. 28665." },
      {
        arg: "searchParameters",
        element: "SearchParameters",
        type: "object",
        required: true,
        label: "Search parameters",
        description: "What to search for. Send {} to list all contacts.",
        fields: [
          { arg: "keyword", element: "KeyWord", type: "string", label: "Keyword", description: "Text to find in the contact's name, email or phone numbers. Optional." },
          { arg: "enabledSystemNotification", element: "EnabledSystemNotification", type: "string", enum: CONTACT_SYSTEM_NOTIFICATIONS, label: "System notification", description: "Only contacts who receive this KPN service or outage notification (one value). Optional." },
          { arg: "enabledThresholdAlert", element: "EnabledThresholdAlert", type: "string", enum: CONTACT_THRESHOLD_ALERTS, label: "Usage alert", description: "Only contacts who receive this usage-limit alert (one value). Optional." },
        ],
      },
      { arg: "offset", element: "Offset", type: "integer", required: true, min: 0, label: "Offset", description: "Number of results to skip for paging, starting at 0 (0 = first page). For the next page, add the limit, e.g. 0, 20, 40." },
      { arg: "limit", element: "Limit", type: "integer", min: 1, label: "Limit", description: "Maximum contacts per page, e.g. 20. Leave empty for KPN's default." },
    ],
  },
  {
    tool: "kpn_grexx_create_contact",
    request: "CreateContactRequest_V1",
    response: "ContactResponse_V1",
    readOnly: false,
    confirm: true,
    // Additive (MCP destructiveHint=false); still confirmed because it can start KPN notifications.
    description:
      "Adds a contact person to a KPN customer's account. They may start receiving the KPN notifications you select. " +
      "You can update or remove the contact later. Confirm with the user before invoking. (Grexx: CreateContactRequest_V1)",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, label: "Customer number", description: "KPN customer number (IRMA customer ID), e.g. 28665." },
      contactDetails("The new contact's details."),
    ],
  },
  {
    tool: "kpn_grexx_update_contact",
    request: "UpdateContactRequest_V1",
    response: "ContactResponse_V1",
    readOnly: false,
    confirm: true,
    destructive: true,
    description:
      "Changes a contact person's details and notification settings on a KPN customer's account. You can change them back later. " +
      "Confirm with the user before invoking. (Grexx: UpdateContactRequest_V1)",
    fields: [
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, label: "Customer number", description: "KPN customer number (IRMA customer ID), e.g. 28665." },
      { arg: "contactId", element: "ContactId", type: "integer", required: true, min: 1, label: "Contact ID", description: "KPN contact ID of the contact to change." },
      contactDetails("The contact's details to send.", true),
    ],
  },
  {
    tool: "kpn_grexx_modify_voip_user",
    request: "ModifyVoipUserRequest_V1",
    response: "ModifyVoipUserResponse_V1",
    readOnly: false,
    confirm: true,
    destructive: true,
    description:
      "Changes a VoIP user's settings in KPN's phone system: name, email, phone number and extension. " +
      "Changing the number or extension changes how calls reach this person. You can change them back later. " +
      "Confirm with the user before invoking. (Grexx: ModifyVoipUserRequest_V1)",
    fields: [
      { arg: "orderId", element: "OrderId", type: "integer", required: true, min: 1, label: "Order number", description: "KPN order number (IRMA order ID) of the VoIP user (phone-system user)." },
      { arg: "firstName", element: "FirstName", type: "string", required: true, label: "First name", description: "First name of the VoIP user." },
      { arg: "lastName", element: "LastName", type: "string", required: true, label: "Last name", description: "Last name of the VoIP user." },
      { arg: "email", element: "Email", type: "string", label: "Email", description: "Email address the VoIP user can also sign in with (alternative username). Optional." },
      { arg: "phoneNumber", element: "PhoneNumber", type: "string", pattern: E164, label: "Phone number", formatHint: E164_HINT, description: "Phone number for this VoIP user in international format, e.g. +31201234567. Optional." },
      { arg: "extension", element: "Extension", type: "string", label: "Extension", description: "Internal extension (short number colleagues dial), e.g. 201. Optional." },
    ],
  },
  {
    tool: "kpn_grexx_modify_device_profile",
    request: "ModifyDeviceProfileRequest_V1",
    response: "ModifyDeviceProfileResponse_V1",
    readOnly: false,
    confirm: true,
    destructive: true,
    description:
      "Changes the setup of a desk phone or other VoIP device in KPN's phone system (type, name, MAC address, line). " +
      "A wrong value can stop the phone from working until it's corrected. You can change it back later. " +
      "Confirm with the user before invoking. (Grexx: ModifyDeviceProfileRequest_V1)",
    fields: [
      { arg: "orderId", element: "OrderId", type: "integer", required: true, min: 1, label: "Order number", description: "KPN order number (IRMA order ID) of the device." },
      { arg: "deviceType", element: "DeviceType", type: "string", required: true, label: "Device type", description: "Phone model, e.g. Yealink T46G." },
      { arg: "macAddress", element: "MacAddress", type: "string", max: 17, pattern: MAC, label: "MAC address", formatHint: "MAC address must be 12 hexadecimal characters, e.g. 00:1A:2B:3C:4D:5E.", description: "Hardware address printed on the phone's label, e.g. 00:1A:2B:3C:4D:5E. Optional." },
      { arg: "deviceName", element: "DeviceName", type: "string", required: true, min: 1, max: 32, label: "Device name", description: "Name of the device, unique within the phone system, up to 32 characters." },
      { arg: "deviceUserName", element: "DeviceUserName", type: "string", min: 1, max: 32, pattern: SAFE_NAME, label: "Device user name", formatHint: "Device user name can contain only letters, digits, - and _.", description: "Device user name, unique across KPN's phone system; letters, digits, - and _ only, up to 32 characters. Optional." },
      { arg: "linePort", element: "LinePort", type: "string", required: true, min: 1, max: 161, pattern: SAFE_NAME, label: "Line port", formatHint: "Line port can contain only letters, digits, - and _.", description: "Device ID that identifies the phone, e.g. in reports; usually the user ID. Letters, digits, - and _ only (up to 161 characters)." },
      { arg: "sipUserName", element: "SipUserName", type: "string", label: "SIP user name", description: "SIP user name. Optional." },
    ],
  },
  {
    tool: "kpn_grexx_delete_contact",
    request: "DeleteContactRequest_V1",
    response: "DeleteContactResponse_V1",
    readOnly: false,
    admin: true,
    confirm: true,
    destructive: true,
    description:
      "⚠ DESTRUCTIVE. Permanently deletes a contact person from a KPN customer's account. They stop receiving KPN notifications. " +
      "This can't be undone. Admin only. Confirm with the user before invoking. (Grexx: DeleteContactRequest_V1)",
    fields: [
      {
        arg: "header",
        element: "Header",
        type: "object",
        required: true,
        generated: true,
        description: "Request header, filled in by the server.",
        fields: [
          { arg: "partnerReference", element: "PartnerReference", type: "string", required: true, description: "Reference generated by the server." },
          { arg: "dateCreated", element: "DateCreated", type: "dateTime", required: true, description: "Request time generated by the server." },
        ],
      },
      { arg: "customerId", element: "CustomerId", type: "integer", required: true, min: 1, label: "Customer number", description: "KPN customer number (IRMA customer ID), e.g. 28665." },
      { arg: "contactId", element: "ContactId", type: "integer", required: true, min: 1, label: "Contact ID", description: "KPN contact ID of the contact to delete." },
    ],
  },
];

/** Describe raw input without constraints that require handler normalization first. */
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
        ...(field.enum ? { enum: [...field.enum] } : {}),
        // The handler validates patterns and maximum length after normalization.
      };
    case "dateTime":
      return { type: "string", format: "date-time", description };
    case "integerList":
      return { type: "array", description, items: { type: "integer", minimum: 1 }, minItems: field.min, maxItems: field.max };
    case "decimal":
      return { type: "number", description, ...(field.min !== undefined ? { minimum: field.min } : {}), ...(field.max !== undefined ? { maximum: field.max } : {}) };
    case "stringList":
      return {
        type: "array",
        description,
        items: { type: "string", enum: field.enum ? [...field.enum] : undefined },
        minItems: field.min,
        maxItems: field.max,
      };
    case "object":
    {
      const required = collectRequiredFields(field.fields ?? []);
      return {
        type: "object",
        description,
        properties: Object.fromEntries(inputFields(field.fields ?? []).map((child) => [child.arg, fieldSchema(child)])),
        ...(required.length > 0 ? { required } : {}),
      };
    }
    default:
      return { type: "string", description, ...(field.enum ? { enum: [...field.enum] } : {}) };
  }
}

/** Fields the caller supplies (server-generated fields are left out of the input schema). */
function inputFields(fields: readonly GrexxField[]): GrexxField[] {
  return fields.filter((field) => field.generated !== true);
}

/** List required caller-supplied fields, excluding server-generated fields. */
function collectRequiredFields(fields: readonly GrexxField[]): string[] {
  return inputFields(fields).filter((field) => field.required).map((field) => field.arg);
}

/** Build the MCP tool definition for a spec. */
export function realtimeTool(spec: GrexxRealtimeSpec): Tool {
  const readOnly = spec.readOnly !== false;
  const requiredArguments = collectRequiredFields(spec.fields);
  const destructive = spec.admin === true || spec.destructive === true;
  return {
    name: spec.tool,
    description: spec.description,
    inputSchema: {
      type: "object",
      properties: {
        ...Object.fromEntries(
          inputFields(spec.fields).map((field) => [field.arg, fieldSchema(field)])
        ) as NonNullable<Tool["inputSchema"]["properties"]>,
        ...(spec.confirm || spec.admin ? { ...CONFIRM_ARG_PROPERTY } : {}),
      },
      ...(requiredArguments.length > 0 ? { required: requiredArguments } : {}),
    },
    annotations: readOnly
      ? { readOnlyHint: true, openWorldHint: true, idempotentHint: true }
      : {
          readOnlyHint: false,
          destructiveHint: destructive,
          openWorldHint: true,
          idempotentHint: false,
        },
  };
}

/**
 * Admin-only tools (e.g. kpn_grexx_delete_contact) are off unless the operator sets
 * KPN_GREXX_ADMIN_TOOLS_ENABLED=1 (or "true"). When off they are neither listed nor callable.
 */
export function grexxAdminToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.KPN_GREXX_ADMIN_TOOLS_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export const GREXX_ADMIN_TOOLS_ENABLED = grexxAdminToolsEnabled();

/** Specs that are exposed: admin-only specs only when the admin flag is on. */
export function enabledRealtimeSpecs(adminEnabled: boolean): GrexxRealtimeSpec[] {
  return GREXX_REALTIME_SPECS.filter((spec) => adminEnabled || spec.admin !== true);
}

export const ENABLED_GREXX_REALTIME_SPECS = enabledRealtimeSpecs(GREXX_ADMIN_TOOLS_ENABLED);

export const GREXX_REALTIME_TOOLS: Tool[] = ENABLED_GREXX_REALTIME_SPECS.map(realtimeTool);
