/**
 * Tools 19–23 (design.md §4.3): the MSM write tools. All five are tier D:
 * "⚠" prefix, inline destructive annotations, CONFIRM_ARG_PROPERTY in the
 * schema, and a description ending "Confirm with the user before invoking."
 */
import type { Tool } from "@modelcontextprotocol/server";
import { CONFIRM_ARG_PROPERTY } from "../elicitation.js";

const contractIdProp = {
  type: "integer",
  description: "MSM contract id (from kpn_mobile_contracts_list).",
};

const orderIdProp = {
  type: "integer",
  description: "MSM order id (from kpn_mobile_orders_list).",
};

const referenceNumberProp = {
  type: "string",
  maxLength: 25,
  description: "Your reference for the KPN order (max 25 chars). Defaults to WYRE-<UTC timestamp>.",
};

export const MOBILE_WRITE_TOOLS: Tool[] = [
  // 19
  {
    name: "kpn_mobile_sim_block",
    description:
      "⚠ HIGH-IMPACT. Block the SIM on a contract (lost/stolen phone): calls, SMS and data " +
      "stop until unblocked. Creates a KPN order; it may need authorization. Confirm with the " +
      "user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: contractIdProp,
        referenceNumber: referenceNumberProp,
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["contractId"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  // 20
  {
    name: "kpn_mobile_sim_unblock",
    description:
      "⚠ HIGH-IMPACT. Unblock a previously blocked SIM, restoring service. Only do this once " +
      "the device is confirmed recovered and in the rightful owner's hands. Confirm with the " +
      "user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: contractIdProp,
        referenceNumber: referenceNumberProp,
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["contractId"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  // 21
  {
    name: "kpn_mobile_sim_replace",
    description:
      "⚠ DESTRUCTIVE. Replace the SIM on a contract with a new physical SIM (ICCID) or an " +
      "eSIM. The current SIM stops working when the order completes. For eSIM an email " +
      "address for the activation QR code is required. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: contractIdProp,
        esim: { type: "boolean", description: "true for an eSIM, false for a physical SIM." },
        newSimCardNumber: {
          type: "string",
          description: "ICCID of the new physical SIM. Required when esim is false.",
        },
        email: {
          type: "string",
          description: "Where KPN sends the eSIM activation QR code. Required when esim is true.",
        },
        wishDate: { type: "string", description: "Requested date, YYYY-MM-DD (optional)." },
        referenceNumber: referenceNumberProp,
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["contractId", "esim"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  // 22
  {
    name: "kpn_mobile_orders_authorize",
    description:
      "⚠ HIGH-IMPACT. Approve an order waiting for authorization (status UNAUTHORIZED) so KPN " +
      "executes it; this may commit the customer to costs. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: orderIdProp,
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["orderId"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  // 23
  {
    name: "kpn_mobile_orders_cancel",
    description:
      "⚠ DESTRUCTIVE. Cancel an open KPN business-mobile order. It cannot be resumed " +
      "afterwards. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: orderIdProp,
        note: { type: "string", description: "Reason for the cancellation (optional)." },
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["orderId"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];
