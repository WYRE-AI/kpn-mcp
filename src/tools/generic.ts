/** Generic / CRM realtime tools: connection probe, RAS, customer and orders. */
import type { Tool } from "@modelcontextprotocol/server";
import { CUSTOMER_ORDER_BY, ORDER_STATES, PRODUCT_GROUPS } from "@wyre-ai/node-kpn";

const READ = { readOnlyHint: true, openWorldHint: true } as const;

export const GENERIC_TOOLS: Tool[] = [
  {
    name: "kpn_grexx_test_connection",
    description:
      "Check Grexx credentials and KPN_GREXX_BASE_URL. Posts an empty ZipCodeCheckRequest_V6 " +
      "(no real address). Codes 103, 104, 105 and 109 mean the account was accepted and only " +
      "the empty XML was rejected. Codes 100–102 and 106 mean authentication failed. " +
      "Reports the auth mode in use (oauth Bearer by default; basic is the fallback).",
    inputSchema: { type: "object", properties: {} },
    annotations: READ,
  },
  {
    name: "kpn_grexx_ras_check",
    description:
      "PPP/RAS session diagnostic for one IRMA order (RasCheckRequest_V1 on POST /realtime). " +
      "Use when a connectivity order looks up but the session or VRF does not.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: {
          type: "integer",
          minimum: 1,
          description: "IRMA order id.",
        },
      },
      required: ["orderId"],
    },
    annotations: READ,
  },
  {
    name: "kpn_grexx_customer_data",
    description:
      "Look up KPN partner customer cards (CustomerDataRequest_V1). Every filter is optional; " +
      "with none, Grexx returns the first page of customers. Take is at most 100 (service default 20).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", minimum: 1, description: "IRMA customer id." },
        name: { type: "string", description: "Customer name filter." },
        street: { type: "string" },
        zipCode: { type: "string", description: "Dutch postcode filter." },
        city: { type: "string" },
        countryCode: { type: "string" },
        phone1: { type: "string" },
        phone2: { type: "string" },
        debitNr: { type: "string" },
        externalId: { type: "string" },
        chamberOfCommerceNr: { type: "string", description: "KvK number." },
        vatNr: { type: "string" },
        includeInactiveCustomers: { type: "boolean" },
        orderByMember: {
          type: "string",
          enum: [...CUSTOMER_ORDER_BY],
          description: "Sort field.",
        },
        orderByDescending: { type: "boolean" },
        skip: { type: "integer", minimum: 0 },
        take: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
    annotations: READ,
  },
  {
    name: "kpn_grexx_order_summary",
    description:
      "List orders on a customer card (OrderSummaryRequest_V1). The portal publishes a request " +
      "XSD only; the body is returned as parsed XML. Take is at most 2500. This is a read; it " +
      "does not place or change an order.",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "integer", minimum: 1, description: "IRMA customer id." },
        orderState: { type: "string", enum: [...ORDER_STATES] },
        productGroup: { type: "string", enum: [...PRODUCT_GROUPS] },
        productName: { type: "string" },
        dateActiveFrom: { type: "string", description: "ISO-8601 date-time." },
        dateActiveTo: { type: "string", description: "ISO-8601 date-time." },
        dateModifiedFrom: { type: "string", description: "ISO-8601 date-time." },
        dateModifiedTo: { type: "string", description: "ISO-8601 date-time." },
        label: { type: "string" },
        attribute: { type: "string" },
        skip: { type: "integer", minimum: 0 },
        take: { type: "integer", minimum: 1, maximum: 2500 },
      },
    },
    annotations: READ,
  },
  {
    name: "kpn_grexx_order_data",
    description:
      "Fetch one IRMA order (OrderDataRequest_V1 → OrderDataResponse_V1). Read only.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "integer", minimum: 1, description: "IRMA order id." },
      },
      required: ["orderId"],
    },
    annotations: READ,
  },
];
