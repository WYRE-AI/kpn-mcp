/** Mobile and porting realtime reads. No SIM swap, block, or order writes. */
import type { Tool } from "@modelcontextprotocol/server";

const READ = { readOnlyHint: true, openWorldHint: true } as const;

export const MOBILE_TOOLS: Tool[] = [
  {
    name: "kpn_grexx_get_sim",
    description:
      "Active SIM on a mobile order (GetSimRequest_V1). OrderId is an integer IRMA order id. " +
      "There is no GetSimCard request. PUK (Puc1) and eSIM activation/confirmation codes are " +
      "masked in the result.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: {
          type: "integer",
          minimum: 1,
          description: "IRMA order id of the mobile order.",
        },
      },
      required: ["orderId"],
    },
    annotations: READ,
  },
  {
    name: "kpn_grexx_mobile_settings",
    description:
      "Blocks and limits on a mobile subscription (GetMobileSettingsRequest_V1), keyed by IRMA order id. " +
      "Read only — changing a block is a queued Modify and is not available in this pilot.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "integer", minimum: 1, description: "IRMA mobile order id." },
      },
      required: ["orderId"],
    },
    annotations: READ,
  },
  {
    name: "kpn_grexx_mobile_usage",
    description:
      "Current usage for one mobile subscription (GetMobileSubscriptionUsageRequest_V1). Realtime read.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "integer", minimum: 1, description: "IRMA mobile order id." },
      },
      required: ["orderId"],
    },
    annotations: READ,
  },
  {
    name: "kpn_grexx_mobile_orders",
    description:
      "Mobile order lookup for 1 to 50 IRMA order ids (GetMobileSubscriptionOrdersRequest_V1). " +
      "The portal publishes a request XSD only; the body is returned as parsed XML. Realtime read.",
    inputSchema: {
      type: "object",
      properties: {
        orderIds: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: { type: "integer", minimum: 1 },
          description: "IRMA order ids. Serialized as OrderIds/OrderId.",
        },
      },
      required: ["orderIds"],
    },
    annotations: READ,
  },
  {
    name: "kpn_grexx_available_portings",
    description:
      "Porting candidates for mobile subscriptions or a HIP group (AvailablePortingsRequest_V1). " +
      "Provide customerId (IRMA customer id; the XML element is spelled MobileSubscripionCustomerId) " +
      "or hipGroupOrderId, or both. Realtime read. Performing a port needs the Proxymodule and is not in this pilot.",
    inputSchema: {
      type: "object",
      properties: {
        customerId: {
          type: "integer",
          minimum: 1,
          description: "IRMA customer id. Maps to MobileSubscripionCustomerId (portal spelling).",
        },
        hipGroupOrderId: { type: "integer", minimum: 1, description: "HIP group order id." },
      },
    },
    annotations: READ,
  },
];
