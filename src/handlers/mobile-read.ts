/**
 * Tool handlers 5–18 (design.md §4.3): KPN business mobile (MSM) reads.
 *
 * Conventions:
 * - Lists page with offset/limit (paging.ts) and return pageMeta next to the
 *   rows. An empty page is an isError "no X found" result, never a bare empty
 *   success (mcp-empty-result-hallucination).
 * - Anything that can carry contract or order details goes through
 *   maskContract. Only kpn_mobile_contracts_get_puk reads the raw PUK, and
 *   only after the confirmDestructive gate.
 */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import {
  buildFilters,
  NotFoundError,
  ServerError,
  type ContractDetails,
  type KpnClient,
  type MsmPage,
  type OrderStatus,
} from "@wyre-ai/node-kpn";
import { confirmDestructive, type ElicitationContext } from "../elicitation.js";
import { CONTRACT_STATES, ORDER_STATUSES } from "../tools/mobile-read.js";
import { maskContract } from "./masking.js";
import { pageMeta, readPaging, toMsmPage } from "./paging.js";
import {
  errorResult,
  jsonResult,
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireInteger,
  textResult,
  ToolInputError,
  type ToolHandler,
  type ToolResult,
} from "./results.js";

const DEFAULT_OPEN_STATUSES: OrderStatus[] = ["NEW", "IN_PROGRESS", "UNAUTHORIZED"];
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PDF_BYTES = 4 * 1024 * 1024;

// ── Helpers ────────────────────────────────────────────────────────────────

function optionalInteger(args: Record<string, unknown>, key: string): number | undefined {
  const value = optionalNumber(args, key);
  if (value !== undefined && !Number.isInteger(value)) {
    throw new ToolInputError(`Argument "${key}" must be an integer.`);
  }
  return value;
}

function optionalDate(args: Record<string, unknown>, key: string): string | undefined {
  const value = optionalString(args, key);
  if (value !== undefined && !ISO_DATE_ONLY.test(value)) {
    throw new ToolInputError(`Argument "${key}" must be a date as YYYY-MM-DD.`);
  }
  return value;
}

/** A single free-text `search` becomes the MSM `patterns[]` query param. */
function patternsFrom(args: Record<string, unknown>): string[] | undefined {
  const search = optionalString(args, "search")?.trim();
  return search ? [search] : undefined;
}

/** One optional string argument → one MSM filter column (or nothing). */
function filterValue(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = optionalString(args, key)?.trim();
  return value ? [value] : undefined;
}

/** Validated `status` array for the order and service-request lists. */
function statusesFrom(args: Record<string, unknown>): OrderStatus[] {
  const statuses = optionalStringArray(args, "status");
  if (statuses === undefined || statuses.length === 0) return DEFAULT_OPEN_STATUSES;
  const allowed: readonly string[] = ORDER_STATUSES;
  const invalid = statuses.filter((s) => !allowed.includes(s));
  if (invalid.length > 0) {
    throw new ToolInputError(
      `Invalid status ${invalid.join(", ")}; use one of: ${ORDER_STATUSES.join(", ")}.`
    );
  }
  return statuses as OrderStatus[];
}

/** True for undefined, null and `{}` — a "found" response with nothing in it. */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === "object" && Object.keys(value).length === 0;
}

/**
 * The page with its paging metadata, or an isError "no X found" result when
 * the page is empty (distinguishing "nothing matches" from "past the end").
 */
function pageResult<T>(
  page: MsmPage<T>,
  offset: number,
  limit: number,
  key: string,
  noun: string,
  qualifier = ""
): ToolResult {
  if (page.result.length === 0) {
    return errorResult(
      page.total > 0 && offset > 0
        ? `No ${noun} found${qualifier} at offset ${offset}; there are ${page.total} in total.`
        : `No ${noun} found${qualifier}.`
    );
  }
  return jsonResult({ ...pageMeta(page, offset, limit), [key]: page.result });
}

// ── Subscribers ────────────────────────────────────────────────────────────

async function listSubscribers(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const { offset, limit } = readPaging(args);
  const page = await client.mobile.subscribers.list({
    ...toMsmPage(args),
    patterns: patternsFrom(args),
    filters: buildFilters({
      FIRSTNAME: filterValue(args, "firstName"),
      LASTNAME: filterValue(args, "lastName"),
      EMPLOYEE_NUMBER: filterValue(args, "employeeNumber"),
      FIXED_NUMBER: filterValue(args, "fixedNumber"),
    }),
  });
  return pageResult(page, offset, limit, "subscribers", "subscribers");
}

async function getSubscriber(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const id = requireInteger(args, "id");
  const includeContracts = optionalBoolean(args, "includeContracts") ?? true;
  const subscriber = await client.mobile.subscribers.get(id);
  if (isEmpty(subscriber)) return errorResult(`No subscriber found with id ${id}.`);
  if (!includeContracts) return jsonResult(subscriber);

  const contracts = await client.mobile.subscribers.listContracts(id, { from: 0, to: 100 });
  return jsonResult({
    ...subscriber,
    contracts: contracts.result,
    contractsTotal: contracts.total,
  });
}

// ── Contracts ──────────────────────────────────────────────────────────────

async function listContracts(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const { offset, limit } = readPaging(args);
  const subscriberId = optionalInteger(args, "subscriberId");
  const patterns = patternsFrom(args);
  const state = optionalEnum(args, "state", CONTRACT_STATES);
  const filters = buildFilters({
    MOBILE_NUMBER: filterValue(args, "mobileNumber"),
    SIM_CARD_NUMBER: filterValue(args, "simCardNumber"),
    IMEI: filterValue(args, "imei"),
    FIRSTNAME: filterValue(args, "firstName"),
    LASTNAME: filterValue(args, "lastName"),
    PRODUCT_NAME: filterValue(args, "productName"),
    STATE: state ? [state] : undefined,
  });

  if (subscriberId !== undefined) {
    // The per-subscriber endpoint takes paging only; refuse rather than ignore filters.
    if (patterns || filters) {
      throw new ToolInputError('"subscriberId" cannot be combined with search or filters.');
    }
    const page = await client.mobile.subscribers.listContracts(subscriberId, toMsmPage(args));
    return pageResult(page, offset, limit, "contracts", "contracts", ` for subscriber ${subscriberId}`);
  }

  const page = await client.mobile.contracts.list({ ...toMsmPage(args), patterns, filters });
  return pageResult(page, offset, limit, "contracts", "contracts");
}

async function getContract(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const id = requireInteger(args, "id");
  const includeItems = optionalBoolean(args, "includeItems") ?? false;
  const details = await client.mobile.contracts.get(id);
  if (isEmpty(details)) return errorResult(`No contract found with id ${id}.`);
  const contract = maskContract(details);
  if (!includeItems) return jsonResult(contract);

  const items = await client.mobile.contracts.getItems(id);
  return jsonResult({ ...contract, items });
}

/** "+31612345678 (user@example.nl, contract 123)" — the concrete target for a prompt. */
function describeContract(id: number, details: ContractDetails): string {
  const who = [details.userPrincipalName, `contract ${id}`].filter(Boolean).join(", ");
  return `${details.phoneNumber ?? "unknown number"} (${who})`;
}

async function getPuk(
  client: KpnClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<ToolResult | InputRequiredResult> {
  const id = requireInteger(args, "id");
  const details = await client.mobile.contracts.get(id);
  if (isEmpty(details)) return errorResult(`No contract found with id ${id}.`);
  if (!details.puk) return errorResult(`No PUK is available for contract ${id}.`);

  const gate = confirmDestructive(
    elicitation,
    args,
    `Reveal the PUK code of the SIM for ${describeContract(id, details)}?`
  );
  if (gate.kind === "ask") return gate.result;
  if (gate.kind === "blocked") return errorResult(gate.message);
  if (gate.kind === "refused") return textResult("Cancelled; nothing was changed.");

  return jsonResult({ contractId: id, phoneNumber: details.phoneNumber, puk: details.puk });
}

async function getOperations(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const contractId = requireInteger(args, "contractId");
  const operations = await client.mobile.contracts.getOperations(contractId);
  if (isEmpty(operations)) {
    return errorResult(`No operations information found for contract ${contractId}.`);
  }
  return jsonResult(operations);
}

// ── Orders and service requests ───────────────────────────────────────────

async function listOrders(client: KpnClient, args: Record<string, unknown>): Promise<ToolResult> {
  const { offset, limit } = readPaging(args);
  const status = statusesFrom(args);
  const page = await client.mobile.orders.list({
    ...toMsmPage(args),
    status,
    patterns: patternsFrom(args),
    currentUserOrdersOnly: optionalBoolean(args, "currentUserOnly"),
    withRequiredActionFirst: true,
  });
  return pageResult(page, offset, limit, "orders", "orders", ` with status ${status.join(", ")}`);
}

async function getOrder(client: KpnClient, args: Record<string, unknown>): Promise<ToolResult> {
  const id = requireInteger(args, "id");
  let order: unknown;
  try {
    order = await client.mobile.orders.getPretty(id);
  } catch (error) {
    // The /pretty view is untyped and less proven; fall back to the typed one.
    if (!(error instanceof NotFoundError || error instanceof ServerError)) throw error;
    order = await client.mobile.orders.get(id);
  }
  if (isEmpty(order)) return errorResult(`No order found with id ${id}.`);
  return jsonResult(maskContract(order));
}

async function listServiceRequests(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const { offset, limit } = readPaging(args);
  const status = statusesFrom(args);
  const page = await client.mobile.serviceRequests.list({
    ...toMsmPage(args),
    status,
    patterns: patternsFrom(args),
    currentUserOrdersOnly: optionalBoolean(args, "currentUserOnly"),
  });
  return pageResult(
    page,
    offset,
    limit,
    "serviceRequests",
    "service requests",
    ` with status ${status.join(", ")}`
  );
}

async function getServiceRequest(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const id = requireInteger(args, "id");
  const request = await client.mobile.serviceRequests.get(id);
  if (isEmpty(request)) return errorResult(`No service request found with id ${id}.`);
  return jsonResult(request);
}

// ── Invoices ───────────────────────────────────────────────────────────────

async function listInvoices(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const { offset, limit } = readPaging(args);
  const page = await client.mobile.invoices.list({
    ...toMsmPage(args),
    debtorId: optionalInteger(args, "debtorId"),
    searchFrom: optionalDate(args, "searchFrom"),
    searchTo: optionalDate(args, "searchTo"),
  });
  // Add the euro amount next to the cents value so nobody misreads 12345 as €12,345.
  const invoices = page.result.map((invoice) =>
    invoice.totalAmountToPayInCents === undefined
      ? invoice
      : { ...invoice, totalAmountToPay: invoice.totalAmountToPayInCents / 100 }
  );
  return pageResult({ ...page, result: invoices }, offset, limit, "invoices", "invoices");
}

async function getInvoicePdf(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const id = requireInteger(args, "id");
  const pdf = await client.mobile.invoices.downloadPdf(id);
  if (pdf.data.byteLength === 0) return errorResult(`No PDF found for invoice ${id}.`);
  if (pdf.data.byteLength > MAX_PDF_BYTES) {
    const mb = (pdf.data.byteLength / 1024 / 1024).toFixed(1);
    return errorResult(
      `Invoice ${id} PDF is ${mb} MB, over the 4 MB limit for tool results; ` +
        "download it from the KPN MSM portal instead."
    );
  }
  const uri = `kpn://invoices/${id}.pdf`;
  return {
    content: [
      { type: "text", text: `Invoice ${id} PDF (${pdf.data.byteLength} bytes) as ${uri}.` },
      {
        type: "resource",
        resource: {
          uri,
          mimeType: pdf.contentType || "application/pdf",
          blob: Buffer.from(pdf.data).toString("base64"),
        },
      },
    ],
  };
}

// ── Organisation ───────────────────────────────────────────────────────────

async function listHierarchy(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const { offset, limit } = readPaging(args);
  const parentId = optionalInteger(args, "parentId");
  const page = await client.mobile.hierarchy.listChildren({
    ...toMsmPage(args),
    id: parentId,
    pattern: optionalString(args, "search")?.trim() || undefined,
    includeCustomer: true,
    includeGroups: true,
  });
  const qualifier = parentId === undefined ? "" : ` under hierarchy item ${parentId}`;
  return pageResult(page, offset, limit, "items", "hierarchy items", qualifier);
}

async function listThresholds(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const { offset, limit } = readPaging(args);
  const thresholdId = optionalInteger(args, "thresholdId");
  if (thresholdId !== undefined) {
    const page = await client.mobile.thresholds.listContracts(thresholdId, toMsmPage(args));
    return pageResult(page, offset, limit, "contracts", "contracts", ` for threshold ${thresholdId}`);
  }
  // GET /contract/thresholds is not paged; apply offset/limit here so the
  // tool behaves like every other list.
  const all = await client.mobile.thresholds.list();
  const page = { result: all.slice(offset, offset + limit), total: all.length };
  return pageResult(page, offset, limit, "thresholds", "thresholds");
}

export const MOBILE_READ_HANDLERS: Record<string, ToolHandler> = {
  kpn_mobile_subscribers_list: listSubscribers,
  kpn_mobile_subscribers_get: getSubscriber,
  kpn_mobile_contracts_list: listContracts,
  kpn_mobile_contracts_get: getContract,
  kpn_mobile_contracts_get_puk: getPuk,
  kpn_mobile_contracts_get_operations: getOperations,
  kpn_mobile_orders_list: listOrders,
  kpn_mobile_orders_get: getOrder,
  kpn_mobile_service_requests_list: listServiceRequests,
  kpn_mobile_service_requests_get: getServiceRequest,
  kpn_mobile_invoices_list: listInvoices,
  kpn_mobile_invoices_get_pdf: getInvoicePdf,
  kpn_mobile_hierarchy_list: listHierarchy,
  kpn_mobile_thresholds_list: listThresholds,
};
