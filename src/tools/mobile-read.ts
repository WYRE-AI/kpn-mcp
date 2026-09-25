/**
 * Tools 5–18 (design.md §4.3): KPN business mobile (MSM) reads.
 *
 * All are tier R except kpn_mobile_contracts_get_puk, which is tier S: a
 * sensitive read that is gated by confirmDestructive (so it carries the
 * "⚠ HIGH-IMPACT" prefix and CONFIRM_ARG_PROPERTY) but is annotated
 * read-only because it changes no state.
 */
import type { Tool } from "@modelcontextprotocol/server";
import { CONFIRM_ARG_PROPERTY } from "../elicitation.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true };

/** Every MSM list tool pages with offset/limit (handlers/paging.ts). */
const PAGING = {
  offset: { type: "integer", minimum: 0, description: "Number of results to skip (default 0)." },
  limit: {
    type: "integer",
    minimum: 1,
    maximum: 100,
    description: "Maximum results to return (1–100, default 20).",
  },
};

export const ORDER_STATUSES = [
  "IN_PROGRESS",
  "UNAUTHORIZED",
  "NEW",
  "CLOSED",
  "CANCELED",
  "REJECTED",
  "DRAFT",
  "THIRD_PARTY",
  "HOLD_CUSTOMER",
  "WAITING",
] as const;

export const CONTRACT_STATES = ["ACTIVE", "CLOSED", "ORDERED", "PENDING", "BLOCKED"] as const;

/** Shared by the order and service-request list tools (#11, #13). */
const STATUS_FILTER = {
  status: {
    type: "array",
    items: { type: "string", enum: [...ORDER_STATUSES] },
    description: 'Statuses to include (default ["NEW","IN_PROGRESS","UNAUTHORIZED"]).',
  },
  search: { type: "string", description: "Free-text search (reference, number, name…)." },
  currentUserOnly: {
    type: "boolean",
    description: "Only items created by the MSM user behind these credentials.",
  },
};

export const MOBILE_READ_TOOLS: Tool[] = [
  // 5
  {
    name: "kpn_mobile_subscribers_list",
    description:
      "Search KPN business-mobile subscribers (employees) by name, employee number or fixed number.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Free-text search across subscriber fields." },
        firstName: { type: "string", description: "Filter on first name." },
        lastName: { type: "string", description: "Filter on last name." },
        employeeNumber: { type: "string", description: "Filter on employee number." },
        fixedNumber: { type: "string", description: "Filter on fixed phone number." },
        ...PAGING,
      },
    },
    annotations: READ_ONLY,
  },
  // 6
  {
    name: "kpn_mobile_subscribers_get",
    description: "Get a subscriber's details and (by default) their mobile/fixed contracts.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Subscriber id." },
        includeContracts: {
          type: "boolean",
          description: "Also list the subscriber's contracts, up to 100 (default true).",
        },
      },
      required: ["id"],
    },
    annotations: READ_ONLY,
  },
  // 7
  {
    name: "kpn_mobile_contracts_list",
    description:
      "Search KPN business-mobile contracts (SIMs/lines) by phone number, SIM card number " +
      "(ICCID), IMEI, name, product or state. Pass subscriberId to list one subscriber's contracts.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Free-text search across contract fields." },
        mobileNumber: { type: "string", description: "Filter on mobile number, e.g. 0612345678." },
        simCardNumber: { type: "string", description: "Filter on SIM card number (ICCID)." },
        imei: { type: "string", description: "Filter on device IMEI." },
        firstName: { type: "string", description: "Filter on the user's first name." },
        lastName: { type: "string", description: "Filter on the user's last name." },
        productName: { type: "string", description: "Filter on product name." },
        state: { type: "string", enum: [...CONTRACT_STATES], description: "Filter on state." },
        subscriberId: {
          type: "integer",
          description: "List this subscriber's contracts instead (no search or filters).",
        },
        ...PAGING,
      },
    },
    annotations: READ_ONLY,
  },
  // 8
  {
    name: "kpn_mobile_contracts_get",
    description:
      "Get a contract's details (number, SIM/ICCID, IMEI, tariff, status, dates, user). PIN/PUK " +
      "are always masked; use kpn_mobile_contracts_get_puk for a PUK.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Contract id." },
        includeItems: {
          type: "boolean",
          description: "Also return the add-on/bundle tree (default false).",
        },
      },
      required: ["id"],
    },
    annotations: READ_ONLY,
  },
  // 9 (tier S)
  {
    name: "kpn_mobile_contracts_get_puk",
    description:
      "⚠ HIGH-IMPACT. Reveal the PUK code of a SIM so a locked phone can be unlocked. PUKs are " +
      "security-sensitive: verify the requester's identity first (consider " +
      "kpn_sim_swap_get_date). Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Contract id." },
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["id"],
    },
    annotations: READ_ONLY,
  },
  // 10
  {
    name: "kpn_mobile_contracts_get_operations",
    description:
      "Show which actions (block/unblock SIM, replace SIM, modify, move, terminate, port-out…) " +
      "are currently allowed on a contract and which open orders block them.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "integer", description: "Contract id." },
      },
      required: ["contractId"],
    },
    annotations: READ_ONLY,
  },
  // 11
  {
    name: "kpn_mobile_orders_list",
    description:
      "List KPN business-mobile orders (SIM blocks, replacements, new lines, hardware…) by " +
      "status. Defaults to open orders. UNAUTHORIZED orders await approval.",
    inputSchema: {
      type: "object",
      properties: { ...STATUS_FILTER, ...PAGING },
    },
    annotations: READ_ONLY,
  },
  // 12
  {
    name: "kpn_mobile_orders_get",
    description:
      "Get an order's details: status, dates, items, costs, SIM/eSIM, delivery and which " +
      "follow-up actions are allowed.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Order id." },
      },
      required: ["id"],
    },
    annotations: READ_ONLY,
  },
  // 13
  {
    name: "kpn_mobile_service_requests_list",
    description:
      "List KPN business-mobile service requests (changes to existing contracts) by status. " +
      "Defaults to open ones.",
    inputSchema: {
      type: "object",
      properties: { ...STATUS_FILTER, ...PAGING },
    },
    annotations: READ_ONLY,
  },
  // 14
  {
    name: "kpn_mobile_service_requests_get",
    description:
      "Get a service request's details (type, status, expected/finish dates, SIM changes, " +
      "attachments list).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Service request id." },
      },
      required: ["id"],
    },
    annotations: READ_ONLY,
  },
  // 15
  {
    name: "kpn_mobile_invoices_list",
    description:
      "List KPN business-mobile invoices (number, date, due date, amount, type) for the " +
      "customer or one debtor, optionally in a date range.",
    inputSchema: {
      type: "object",
      properties: {
        debtorId: {
          type: "integer",
          description: "Only this debtor's invoices (debtor ids come from kpn_mobile_hierarchy_list).",
        },
        searchFrom: { type: "string", description: "Earliest invoice date, YYYY-MM-DD." },
        searchTo: { type: "string", description: "Latest invoice date, YYYY-MM-DD." },
        ...PAGING,
      },
    },
    annotations: READ_ONLY,
  },
  // 16
  {
    name: "kpn_mobile_invoices_get_pdf",
    description: "Download one invoice as a PDF (returned as an embedded resource).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Invoice id (from kpn_mobile_invoices_list)." },
      },
      required: ["id"],
    },
    annotations: READ_ONLY,
  },
  // 17
  {
    name: "kpn_mobile_hierarchy_list",
    description:
      "Browse the customer's KPN organisation tree (customer, debtors, cost centres, groups, " +
      "locations, subscribers). Omit parentId for the roots. Debtor ids feed " +
      "kpn_mobile_invoices_list.",
    inputSchema: {
      type: "object",
      properties: {
        parentId: { type: "integer", description: "List this item's children (omit for the roots)." },
        search: { type: "string", description: "Free-text search on item names." },
        ...PAGING,
      },
    },
    annotations: READ_ONLY,
  },
  // 18
  {
    name: "kpn_mobile_thresholds_list",
    description:
      "List daily usage caps/alerts (national/roaming data MB, voice minutes, roaming €). Pass " +
      "thresholdId to list the contracts it applies to.",
    inputSchema: {
      type: "object",
      properties: {
        thresholdId: {
          type: "integer",
          description: "List the contracts this threshold applies to instead.",
        },
        ...PAGING,
      },
    },
    annotations: READ_ONLY,
  },
];
