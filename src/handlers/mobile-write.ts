/**
 * Tools 19–23: MSM write tools (SIM block/unblock/replace, order
 * authorize/cancel). Every one follows the same MRTR-safe shape:
 *
 *   validate args → pre-condition reads → confirmDestructive → ONE mutation
 *
 * A retried request re-runs the handler from the top, so the mutation is
 * always the last call. MSM order POSTs are never retried by the SDK; a 5xx
 * surfaces to the user with a "check kpn_mobile_orders_list" hint (added by
 * describeKpnError).
 */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import {
  referenceNumber as defaultReferenceNumber,
  ValidationError,
  type Contract,
  type ContractDetails,
  type KpnClient,
  type OperationAvailability,
  type OrderDetails,
  type OrderSummary,
} from "@wyre-technology/node-kpn";
import { confirmDestructive, type ElicitationContext } from "../elicitation.js";
import {
  errorResult,
  jsonResult,
  optionalString,
  requireInteger,
  textResult,
  ToolInputError,
  type ToolHandler,
  type ToolResult,
} from "./results.js";

type WriteResult = ToolResult | InputRequiredResult;

const CANCELLED = "Cancelled; nothing was changed.";

// ── argument helpers ───────────────────────────────────────────────────

/** Optional caller reference (≤ 25 chars), else the SDK default `WYRE-<UTC stamp>`. */
function readReferenceNumber(args: Record<string, unknown>): string {
  const value = optionalString(args, "referenceNumber");
  if (value === undefined) return defaultReferenceNumber();
  if (value.trim() === "" || value.length > 25) {
    throw new ToolInputError('Argument "referenceNumber" must be 1 to 25 characters.');
  }
  return value;
}

function readWishDate(args: Record<string, unknown>): string | undefined {
  const value = optionalString(args, "wishDate");
  if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ToolInputError('Argument "wishDate" must be a date in YYYY-MM-DD format.');
  }
  return value;
}

// ── read-back helpers (all run before the gate) ────────────────────────

/**
 * The live payload may carry Contract-list fields next to ContractDetails
 * (mobileNumber, firstName, lastName); read whichever is present.
 */
type ContractView = ContractDetails & Pick<Contract, "mobileNumber" | "firstName" | "lastName">;

function isEmpty(value: unknown): boolean {
  return value === null || typeof value !== "object" || Object.keys(value).length === 0;
}

/** "+31612345678 (Jan Jansen, contract 123456)" — the concrete confirm target. */
function describeContract(contractId: number, c: ContractView): string {
  const number = c.phoneNumber ?? c.mobileNumber ?? c.fixedNumber;
  const person = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.userPrincipalName;
  const context = [person, `contract ${contractId}`].filter(Boolean).join(", ");
  return number ? `${number} (${context})` : context;
}

/** The isError text for an operation KPN does not currently allow. */
function notAllowed(label: string, contractId: number, op: OperationAvailability | undefined): string {
  const blocking = (op?.blockingOrders ?? []).map(
    (o) => `#${o.id}${o.kpnReference ? ` (${o.kpnReference}, ${o.status ?? "unknown status"})` : ""}`
  );
  const reason = blocking.length
    ? ` Blocking orders: ${blocking.join("; ")}. Check them with kpn_mobile_orders_get.`
    : " Check kpn_mobile_contracts_get_operations for details.";
  return `${label} is not currently allowed on contract ${contractId}.${reason}`;
}

/**
 * Pre-condition reads shared by the three SIM tools: the operation must be
 * enabled, and the contract must exist (its details feed the confirm text).
 * Returns the confirm target, or an isError result to return as-is.
 */
async function checkContract(
  client: KpnClient,
  contractId: number,
  operation: "blockSim" | "unblockSim" | "replaceSim",
  label: string
): Promise<{ target: string } | { error: ToolResult }> {
  const ops = await client.mobile.contracts.getOperations(contractId);
  if (ops?.[operation]?.enabled !== true) {
    return { error: errorResult(notAllowed(label, contractId, ops?.[operation])) };
  }
  const details = await client.mobile.contracts.get(contractId);
  if (isEmpty(details)) {
    return { error: errorResult(`No KPN mobile contract found with id ${contractId}.`) };
  }
  return { target: describeContract(contractId, details as ContractView) };
}

async function getOrder(client: KpnClient, orderId: number): Promise<OrderDetails | undefined> {
  const order = await client.mobile.orders.get(orderId);
  return isEmpty(order) ? undefined : order;
}

function euros(cents: number | undefined): string {
  return cents === undefined ? "unknown" : `€${(cents / 100).toFixed(2)}`;
}

function orderType(order: OrderDetails): string {
  return order.type?.en ?? order.type?.nl ?? "order";
}

function orderedFor(order: OrderDetails): string {
  const r = order.personsInvolved?.receivedBy;
  const name = [r?.firstName, r?.prefix, r?.lastName].filter(Boolean).join(" ");
  return name || r?.companyName || order.msisdn || "unknown";
}

// ── result ─────────────────────────────────────────────────────────────

/** A created order plus how to follow it up (design.md §4.3). */
function orderCreated(order: OrderSummary): ToolResult {
  const track = order.id !== undefined ? `kpn_mobile_orders_get ${order.id}` : "kpn_mobile_orders_list";
  return jsonResult({
    order,
    note:
      `KPN processes this asynchronously; track it with ${track}. If status is ` +
      "WaitingForAuthorization, an authorised user must approve it (kpn_mobile_orders_authorize).",
  });
}

// ── handlers ───────────────────────────────────────────────────────────

async function blockSim(
  client: KpnClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<WriteResult> {
  const contractId = requireInteger(args, "contractId");
  const reference = readReferenceNumber(args);

  const check = await checkContract(client, contractId, "blockSim", "Blocking the SIM");
  if ("error" in check) return check.error;

  const gate = confirmDestructive(
    elicitation,
    args,
    `Block the SIM of ${check.target}? Calls, SMS and data stop until it is unblocked.`
  );
  if (gate.kind === "ask") return gate.result;
  if (gate.kind === "blocked") return errorResult(gate.message);
  if (gate.kind === "refused") return textResult(CANCELLED);

  return orderCreated(
    await client.mobile.contracts.blockSim({ contractId, referenceNumber: reference })
  );
}

async function unblockSim(
  client: KpnClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<WriteResult> {
  const contractId = requireInteger(args, "contractId");
  const reference = readReferenceNumber(args);

  const check = await checkContract(client, contractId, "unblockSim", "Unblocking the SIM");
  if ("error" in check) return check.error;

  const gate = confirmDestructive(
    elicitation,
    args,
    `Unblock the SIM of ${check.target}, restoring calls, SMS and data?`
  );
  if (gate.kind === "ask") return gate.result;
  if (gate.kind === "blocked") return errorResult(gate.message);
  if (gate.kind === "refused") return textResult(CANCELLED);

  return orderCreated(
    await client.mobile.contracts.unblockSim({ contractId, referenceNumber: reference })
  );
}

async function replaceSim(
  client: KpnClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<WriteResult> {
  const contractId = requireInteger(args, "contractId");
  const esim = args.esim;
  if (typeof esim !== "boolean") {
    throw new ToolInputError('Argument "esim" is required and must be a boolean.');
  }
  const newSimCardNumber = optionalString(args, "newSimCardNumber")?.trim();
  const email = optionalString(args, "email")?.trim();
  if (!esim && !newSimCardNumber) {
    throw new ToolInputError('Argument "newSimCardNumber" is required for a physical SIM.');
  }
  if (esim && !email?.includes("@")) {
    throw new ToolInputError('Argument "email" must be a valid email address for an eSIM.');
  }
  const wishDate = readWishDate(args);
  const reference = readReferenceNumber(args);

  const check = await checkContract(client, contractId, "replaceSim", "Replacing the SIM");
  if ("error" in check) return check.error;

  if (!esim) {
    try {
      await client.mobile.contracts.validateSimReplacement({
        contractId,
        newSimCardNumber: newSimCardNumber!,
      });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      const code = error.code ? ` (${error.code})` : "";
      return errorResult(
        `KPN rejected SIM card number ${newSimCardNumber}${code}: ${error.message}. Nothing was changed.`
      );
    }
  }

  const replacement = esim
    ? `an eSIM (activation QR code sent to ${email})`
    : `the physical SIM ${newSimCardNumber}`;
  const gate = confirmDestructive(
    elicitation,
    args,
    `Replace the SIM of ${check.target} with ${replacement}? ` +
      "The current SIM stops working when the order completes."
  );
  if (gate.kind === "ask") return gate.result;
  if (gate.kind === "blocked") return errorResult(gate.message);
  if (gate.kind === "refused") return textResult(CANCELLED);

  return orderCreated(
    await client.mobile.contracts.replaceSim({
      contractId,
      esim,
      ...(esim ? { email } : { newSimCardNumber }),
      ...(wishDate ? { wishDate } : {}),
      referenceNumber: reference,
    })
  );
}

async function authorizeOrder(
  client: KpnClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<WriteResult> {
  const orderId = requireInteger(args, "orderId");

  const order = await getOrder(client, orderId);
  if (!order) return errorResult(`No KPN mobile order found with id ${orderId}.`);
  if (order.status !== "UNAUTHORIZED") {
    return errorResult(
      `Order ${orderId} has status ${order.status ?? "unknown"}; only UNAUTHORIZED orders ` +
        "can be authorized. Nothing was changed."
    );
  }

  const gate = confirmDestructive(
    elicitation,
    args,
    `Authorize order ${orderId} (${orderType(order)}, for ${orderedFor(order)}; one-time ` +
      `${euros(order.oneTimeCostInCents)}, recurring ${euros(order.recurringCostInCents)})? ` +
      "KPN will execute it and the customer may be charged."
  );
  if (gate.kind === "ask") return gate.result;
  if (gate.kind === "blocked") return errorResult(gate.message);
  if (gate.kind === "refused") return textResult(CANCELLED);

  return orderCreated(await client.mobile.orders.authorize(orderId));
}

async function cancelOrder(
  client: KpnClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<WriteResult> {
  const orderId = requireInteger(args, "orderId");
  const note = optionalString(args, "note");

  const order = await getOrder(client, orderId);
  if (!order) return errorResult(`No KPN mobile order found with id ${orderId}.`);
  // The availability flag is optional in the spec: enforce it only when present.
  if (order.cancelOrder && order.cancelOrder.enabled !== true) {
    return errorResult(
      `Order ${orderId} (status ${order.status ?? "unknown"}) cannot be cancelled now. Nothing was changed.`
    );
  }

  const gate = confirmDestructive(
    elicitation,
    args,
    `Cancel order ${orderId} (${orderType(order)}, status ${order.status ?? "unknown"})? ` +
      "It cannot be resumed afterwards."
  );
  if (gate.kind === "ask") return gate.result;
  if (gate.kind === "blocked") return errorResult(gate.message);
  if (gate.kind === "refused") return textResult(CANCELLED);

  const result = await client.mobile.orders.cancel(orderId, note);
  return jsonResult({
    cancelled: true,
    orderId,
    result: result ?? null,
    note: `KPN processes the cancellation asynchronously; track it with kpn_mobile_orders_get ${orderId}.`,
  });
}

export const MOBILE_WRITE_HANDLERS: Record<string, ToolHandler> = {
  kpn_mobile_sim_block: blockSim,
  kpn_mobile_sim_unblock: unblockSim,
  kpn_mobile_sim_replace: replaceSim,
  kpn_mobile_orders_authorize: authorizeOrder,
  kpn_mobile_orders_cancel: cancelOrder,
};
