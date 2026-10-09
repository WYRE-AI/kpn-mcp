/**
 * Phase-1 Grexx / IRMA tools.
 *
 * Names are `kpn_grexx_*` so they cannot be confused with the developer.kpn.com
 * `kpn_*` tools. Every tool here is a realtime read. Field lists come from the
 * `@wyre-ai/node-kpn` builders (today: ZipCodeCheckRequest_V6 only). Tools
 * whose XSD is not in the SDK are not registered — see docs/GREXX.md.
 */
import type { Tool } from "@modelcontextprotocol/server";
import { ZIP_CODE_PORTFOLIOS, ZIP_CODE_SUPPLIERS } from "@wyre-ai/node-kpn";

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
];
