/**
 * Grexx / IRMA realtime tools.
 *
 * Names are `kpn_grexx_*` so they cannot be confused with the developer.kpn.com
 * `kpn_*` tools. The tools in this file use `@wyre-ai/node-kpn` builders
 * (ZipCodeCheckRequest_V6, PrequalificationRequest_V2, OrderDataRequest_V1).
 * The other realtime calls are XSD specs in grexx-realtime.ts, appended at the
 * end. See docs/GREXX.md.
 */
import type { Tool } from "@modelcontextprotocol/server";
import { GREXX_REALTIME_TOOLS } from "./grexx-realtime.js";
import {
  PREQUALIFICATION_AVAILABILITIES,
  PREQUALIFICATION_PRODUCT_TYPES,
  PREQUALIFICATION_SUPPLIERS,
  ZIP_CODE_PORTFOLIOS,
  ZIP_CODE_SUPPLIERS,
} from "@wyre-ai/node-kpn";

export const GREXX_TOOLS: Tool[] = [
  {
    name: "kpn_grexx_test_connection",
    description:
      "Verify Grexx IRMA credentials. GrexxClient mints an OAuth 2.0 client_credentials token " +
      "(scope=all): HTTP Basic first, then form-body client_id and client_secret after HTTP 400/401 invalid_client. " +
      "It posts ZipCodeCheckRequest_V6 for the public reference address 1012JS 1, portfolio All, with the Bearer token. " +
      "This server does not build the token request. Success means the token endpoint and POST /realtime accepted the call. " +
      "The probe does not read a customer record.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  {
    name: "kpn_grexx_zipcode_check",
    description:
      "Technology and speeds at a Dutch address via Grexx ZipCodeCheckRequest_V6 " +
      "(POST /realtime, OAuth Bearer). Returns ZipCodeCheckResponse_V5 suppliers and speeds. " +
      "Portfolio is Business, SMB, Teleworker, or All. Omit suppliers to check every supplier. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        portfolio: {
          type: "string",
          enum: [...ZIP_CODE_PORTFOLIOS],
          description: "XSD Portfolio. Business, SMB, Teleworker, or All.",
        },
        zipCode: {
          type: "string",
          description: 'Dutch postcode, for example "1012JS" or "1012 JS".',
        },
        houseNumber: {
          type: "integer",
          description: "XSD HouseNr. Positive integer.",
        },
        houseNumberExtension: {
          type: "string",
          description: "XSD HouseNrExtension. Optional.",
        },
        serviceId: {
          type: "string",
          description: "XSD ServiceId. Optional. KPN lines only.",
        },
        roomNumber: {
          type: "string",
          description: "XSD RoomNumber. Optional.",
        },
        isRoomNumberKnown: {
          type: "boolean",
          description: "XSD IsRoomNumberKnown. Required. False when the room number is not known.",
        },
        suppliers: {
          type: "array",
          description: "XSD Suppliers. Omit or pass an empty list to check every supplier.",
          items: { type: "string", enum: [...ZIP_CODE_SUPPLIERS] },
        },
      },
      required: ["portfolio", "zipCode", "houseNumber", "isRoomNumberKnown"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  {
    name: "kpn_grexx_prequalification",
    description:
      "Address and product-type availability per supplier via Grexx PrequalificationRequest_V2 " +
      "(POST /realtime, OAuth Bearer). Returns PrequalificationResponse_V1 address fields and products " +
      `(availability ${PREQUALIFICATION_AVAILABILITIES.join(", ")}). ` +
      "When hasBroadband is true, serviceId or referencePhoneNumber is required. " +
      "Omit suppliers to check every supplier. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        zipCode: {
          type: "string",
          description: 'XSD ZipCode. Dutch postcode, for example "1012JS" or "9999ZZ".',
        },
        houseNumber: {
          type: "integer",
          description: "XSD HouseNr. xs:int.",
        },
        houseNumberExtension: {
          type: "string",
          description: "XSD HouseNrExtension. Optional.",
        },
        roomNumber: {
          type: "string",
          description: "XSD RoomNumber. Optional.",
        },
        hasBroadband: {
          type: "boolean",
          description:
            "XSD HasBroadband. Required. When true, serviceId or referencePhoneNumber is required.",
        },
        hasPhone: {
          type: "boolean",
          description: "XSD HasPhone. Required.",
        },
        orderId: {
          type: "string",
          description: "XSD OrderId. Optional. Pattern OID followed by digits.",
        },
        phoneNumber: {
          type: "string",
          description: "XSD PhoneNumber. Optional.",
        },
        productTypeCode: {
          type: "string",
          enum: [...PREQUALIFICATION_PRODUCT_TYPES],
          description: "XSD ProductTypeCode.",
        },
        referencePhoneNumber: {
          type: "string",
          description: "XSD ReferencePhoneNumber. Optional. Satisfies the HasBroadband rule.",
        },
        serviceId: {
          type: "string",
          description: "XSD ServiceId. Optional. Satisfies the HasBroadband rule.",
        },
        suppliers: {
          type: "array",
          description:
            "XSD Suppliers. Omit or pass an empty list to check every supplier. Tokens differ from ZipCodeCheck (Kpn, not KPN).",
          items: { type: "string", enum: [...PREQUALIFICATION_SUPPLIERS] },
        },
        israSpecs: {
          type: "string",
          description: "XSD IsraSpecs. Optional.",
        },
        isComplexAddress: {
          type: "boolean",
          description: "XSD IsComplexAddress. Optional.",
        },
      },
      required: ["zipCode", "houseNumber", "hasBroadband", "hasPhone", "productTypeCode"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  {
    name: "kpn_grexx_order_data",
    description:
      "Customer id, product code, and quantity for an IRMA order via Grexx OrderDataRequest_V1 " +
      "(POST /realtime, OAuth Bearer). Returns OrderDataResponse_V1. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: {
          type: "integer",
          description: "XSD OrderId. xs:int.",
        },
      },
      required: ["orderId"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  ...GREXX_REALTIME_TOOLS,
];
