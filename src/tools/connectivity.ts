/** Connectivity realtime tools. All POST /realtime reads or a diagnose start. */
import type { Tool } from "@modelcontextprotocol/server";
import {
  CARRIER_PRODUCT_TYPES,
  PREQUALIFICATION_PRODUCT_TYPES,
  SYMPTOM_CODES,
  ZIP_CODE_PORTFOLIOS,
} from "@wyre-ai/node-kpn";

const READ = { readOnlyHint: true, openWorldHint: true } as const;

export const CONNECTIVITY_TOOLS: Tool[] = [
  {
    name: "kpn_grexx_zipcode_check",
    description:
      "Address technology and speeds (ZipCodeCheckRequest_V6; the response root is " +
      "ZipCodeCheckResponse_V5). Closest Grexx replacement for a KPN availability check. " +
      "Realtime read on POST /realtime.",
    inputSchema: {
      type: "object",
      properties: {
        portfolio: {
          type: "string",
          enum: [...ZIP_CODE_PORTFOLIOS],
          description: "Product portfolio to check.",
        },
        zipCode: { type: "string", description: 'Dutch postcode, e.g. "1234AB".' },
        houseNumber: { type: "integer", minimum: 1, description: "House number (HouseNr)." },
        houseNumberExtension: { type: "string", description: "Toevoeging. Optional." },
        serviceId: { type: "string" },
        roomNumber: { type: "string" },
        isRoomNumberKnown: {
          type: "boolean",
          description: "Required. True when roomNumber is a known value (including explicitly empty).",
        },
        suppliers: {
          type: "array",
          items: { type: "string" },
          description: "Supplier names. Omit to check every supplier.",
        },
      },
      required: ["portfolio", "zipCode", "houseNumber", "isRoomNumberKnown"],
    },
    annotations: READ,
  },
  {
    name: "kpn_grexx_prequalification",
    description:
      "Pre-order feasibility at an address (PrequalificationRequest_V2; response root is " +
      "PrequalificationResponse_V1). When hasBroadband is true, serviceId or referencePhoneNumber " +
      "is required. Realtime read.",
    inputSchema: {
      type: "object",
      properties: {
        zipCode: { type: "string", description: "Dutch postcode." },
        houseNumber: { type: "integer", minimum: 1 },
        houseNumberExtension: { type: "string" },
        roomNumber: { type: "string" },
        hasBroadband: { type: "boolean" },
        hasPhone: { type: "boolean" },
        orderId: {
          type: "string",
          description: 'Existing order reference matching OID plus digits, e.g. "OID123". Optional.',
        },
        phoneNumber: { type: "string" },
        productTypeCode: { type: "string", enum: [...PREQUALIFICATION_PRODUCT_TYPES] },
        referencePhoneNumber: { type: "string" },
        serviceId: { type: "string" },
        suppliers: { type: "array", items: { type: "string" } },
        israSpecs: { type: "string" },
        isComplexAddress: { type: "boolean" },
      },
      required: ["zipCode", "houseNumber", "hasBroadband", "hasPhone", "productTypeCode"],
    },
    annotations: READ,
  },
  {
    name: "kpn_grexx_carrier_info",
    description:
      "Infrastructure and carrier at a location (CarrierInfoRequest_V1). House number is the " +
      "element HouseNumber (1–99999). PhoneNumber, when set, is 0 plus 9 digits and applies to xDSL. " +
      "Realtime read.",
    inputSchema: {
      type: "object",
      properties: {
        productType: { type: "string", enum: [...CARRIER_PRODUCT_TYPES] },
        zipCode: {
          type: "string",
          description: "Dutch postcode: 4 digits, optional space, 2 letters.",
        },
        houseNumber: { type: "integer", minimum: 1, maximum: 99999 },
        houseNumberExt: { type: "string", description: "At most 4 characters. Optional." },
        phoneNumber: { type: "string", description: "xDSL only. 0 plus 9 digits." },
        israSpecification: { type: "string", description: "xDSL only. Three digits." },
        serviceId: { type: "string" },
      },
      required: ["productType", "zipCode", "houseNumber"],
    },
    annotations: READ,
  },
  {
    name: "kpn_grexx_radius_check",
    description:
      "Recent modem/CPE RADIUS logins for one connectivity order (RadiusCheckRequest_V1). " +
      "Passwords in the response are masked before they are returned. Realtime read.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "integer", minimum: 1, description: "IRMA connectivity order id." },
      },
      required: ["orderId"],
    },
    annotations: READ,
  },
  {
    name: "kpn_grexx_start_line_diagnose",
    description:
      "Start an xDSL line diagnose (StartLineDiagnoseRequest_V1) for an Ethernet connection that " +
      "is out of sync. Returns an analysis id when Grexx accepts the start. Fetching the finished " +
      "diagnose (GetLatest / queued LineDiagnose) needs the Proxymodule and is not in this pilot. " +
      "This call does not change the customer's service.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "integer", minimum: 1, description: "IRMA xDSL order id." },
        symptomCode: {
          type: "string",
          enum: [...SYMPTOM_CODES],
          description: "SymptomCode_V1 value from the portal XSD.",
        },
        partnerReference: {
          type: "string",
          description: "Optional partner reference. Requires dateCreated when set.",
        },
        dateCreated: {
          type: "string",
          description: "ISO-8601 date-time for the diagnose header. Required when partnerReference is set.",
        },
      },
      required: ["orderId", "symptomCode"],
    },
    annotations: { ...READ, readOnlyHint: false, destructiveHint: false },
  },
];
