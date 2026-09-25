/**
 * MSM write tools (19–23) against a stubbed KpnClient. Elicitation runs
 * through the real MRTR helpers: a form-capable caller with no responses gets
 * an `input_required` ask; a retried request carries the answer in
 * `inputResponses`; no context means no elicitation (the gateway path).
 *
 * The invariant under test everywhere: the mutation fires exactly once, and
 * only after every read and a confirmation.
 */
import { describe, expect, it, vi, type Mock } from "vitest";
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import { NotFoundError, ServerError, ValidationError } from "@wyre-ai/node-kpn";
import { CONFIRM_ARG, type ElicitationContext } from "../elicitation.js";
import { handleToolCall } from "../handlers/index.js";
import type { ToolResult } from "../handlers/results.js";
import { stubClient, type StubClient, type StubTree } from "./stub-client.js";

/**
 * The mock view of a stub's MSM resources. StubClient intersects the mock tree
 * with KpnClient, and TypeScript resolves the resource methods to the SDK
 * signatures, so `.mock` / `.mockResolvedValue` need this view.
 */
function mocks(client: StubClient): StubTree["mobile"] {
  return (client as unknown as StubTree).mobile;
}

const FORM_CAPABLE: ElicitationContext = { clientCapabilities: { elicitation: {} } };

/** A retried request carrying the user's answer to the confirmation. */
function answered(confirm: boolean): ElicitationContext {
  return {
    clientCapabilities: { elicitation: {} },
    inputResponses: { confirm: { action: "accept", content: { confirm } } },
  };
}

/** Narrow a handler result to a plain tool result (i.e. not an MRTR ask). */
function asTool(result: ToolResult | InputRequiredResult): ToolResult {
  expect((result as { resultType?: string }).resultType).toBeUndefined();
  return result as ToolResult;
}

function text(result: ToolResult | InputRequiredResult): string {
  const content = asTool(result).content[0];
  return content.type === "text" ? content.text : "";
}

function askMessage(result: ToolResult | InputRequiredResult): string {
  expect((result as InputRequiredResult).resultType).toBe("input_required");
  const params = (result as InputRequiredResult).inputRequests?.confirm?.params as {
    message: string;
  };
  return params.message;
}

// Fictional fixtures — no real people or numbers.
const CONTRACT_ID = 123456;
const ORDER_ID = 777001;
const CONTRACT = {
  id: CONTRACT_ID,
  phoneNumber: "+31612345678",
  userPrincipalName: "j.jansen@example.test",
  pin: "1111",
  puk: "22223333",
};
const UNAUTHORIZED_ORDER = {
  id: ORDER_ID,
  status: "UNAUTHORIZED",
  type: { en: "New mobile line", nl: "Nieuwe mobiele lijn" },
  personsInvolved: { receivedBy: { firstName: "Piet", lastName: "Pietersen" } },
  oneTimeCostInCents: 2500,
  recurringCostInCents: 1299,
};
const OPEN_ORDER = {
  id: ORDER_ID,
  status: "IN_PROGRESS",
  type: { en: "Block SIM" },
  cancelOrder: { enabled: true, visible: true },
};
const SUMMARY = { id: 900001, operation: "BLOCK_SIM", status: "WaitingForAuthorization" };

const enabled = { enabled: true, visible: true };

/** Stub where every pre-condition passes. */
function readyClient(): StubClient {
  return stubClient({
    mobile: {
      contracts: {
        getOperations: vi.fn(async () => ({
          contractId: CONTRACT_ID,
          blockSim: enabled,
          unblockSim: enabled,
          replaceSim: enabled,
        })),
        get: vi.fn(async () => CONTRACT),
        blockSim: vi.fn(async () => SUMMARY),
        unblockSim: vi.fn(async () => SUMMARY),
        replaceSim: vi.fn(async () => SUMMARY),
      },
      orders: {
        get: vi.fn(async (id: number) =>
          id === ORDER_ID ? UNAUTHORIZED_ORDER : { ...OPEN_ORDER, id }
        ),
        authorize: vi.fn(async () => SUMMARY),
        cancel: vi.fn(async () => ({})),
      },
    },
  });
}

interface WriteCase {
  name: string;
  args: Record<string, unknown>;
  mutation: (c: StubClient) => Mock;
  /** The pre-condition read whose empty answer means "not found". */
  lookup: (c: StubClient) => Mock;
  /** A string the confirmation must name (the concrete target). */
  target: string;
}

const CANCEL_ORDER_ID = 777002; // readyClient returns an open, cancellable order for it

const CASES: WriteCase[] = [
  {
    name: "kpn_mobile_sim_block",
    args: { contractId: CONTRACT_ID },
    mutation: (c) => mocks(c).contracts.blockSim,
    lookup: (c) => mocks(c).contracts.get,
    target: "+31612345678",
  },
  {
    name: "kpn_mobile_sim_unblock",
    args: { contractId: CONTRACT_ID },
    mutation: (c) => mocks(c).contracts.unblockSim,
    lookup: (c) => mocks(c).contracts.get,
    target: "+31612345678",
  },
  {
    name: "kpn_mobile_sim_replace",
    args: { contractId: CONTRACT_ID, esim: false, newSimCardNumber: "8931000000000000001" },
    mutation: (c) => mocks(c).contracts.replaceSim,
    lookup: (c) => mocks(c).contracts.get,
    target: "+31612345678",
  },
  {
    name: "kpn_mobile_orders_authorize",
    args: { orderId: ORDER_ID },
    mutation: (c) => mocks(c).orders.authorize,
    lookup: (c) => mocks(c).orders.get,
    target: `order ${ORDER_ID}`,
  },
  {
    name: "kpn_mobile_orders_cancel",
    args: { orderId: CANCEL_ORDER_ID },
    mutation: (c) => mocks(c).orders.cancel,
    lookup: (c) => mocks(c).orders.get,
    target: `order ${CANCEL_ORDER_ID}`,
  },
];

describe.each(CASES)("$name", ({ name, args, mutation, lookup, target }) => {
  describe("confirmation gate (all four outcomes)", () => {
    it("form-capable caller, no response → input_required naming the target; no mutation", async () => {
      const client = readyClient();
      const result = await handleToolCall(client, name, args, FORM_CAPABLE);
      expect(askMessage(result)).toContain(target);
      expect(mutation(client)).not.toHaveBeenCalled();
    });

    it("accepted → the mutation fires exactly once", async () => {
      const client = readyClient();
      const result = asTool(await handleToolCall(client, name, args, answered(true)));
      expect(result.isError).toBeUndefined();
      expect(mutation(client)).toHaveBeenCalledTimes(1);
      expect(text(result)).toContain("kpn_mobile_orders_get");
    });

    it("declined → cancelled, no mutation", async () => {
      const client = readyClient();
      const result = await handleToolCall(client, name, args, answered(false));
      expect(text(result)).toBe("Cancelled; nothing was changed.");
      expect(mutation(client)).not.toHaveBeenCalled();
    });

    it("no elicitation and no CONFIRM_ARG → blocked, no mutation", async () => {
      const client = readyClient();
      const result = asTool(await handleToolCall(client, name, args));
      expect(result.isError).toBe(true);
      expect(text(result)).toContain(CONFIRM_ARG);
      expect(text(result)).toContain(target);
      expect(mutation(client)).not.toHaveBeenCalled();
    });

    it("no elicitation but CONFIRM_ARG: true → proceeds once", async () => {
      const client = readyClient();
      const result = asTool(await handleToolCall(client, name, { ...args, [CONFIRM_ARG]: true }));
      expect(result.isError).toBeUndefined();
      expect(mutation(client)).toHaveBeenCalledTimes(1);
    });
  });

  it("invalid argument → isError, nothing called", async () => {
    const client = readyClient();
    const idKey = "contractId" in args ? "contractId" : "orderId";
    const result = asTool(await handleToolCall(client, name, { ...args, [idKey]: "abc" }));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Invalid arguments");
    expect(lookup(client)).not.toHaveBeenCalled();
    expect(mutation(client)).not.toHaveBeenCalled();
  });

  it("empty lookup result → isError 'no … found', no mutation", async () => {
    const client = readyClient();
    lookup(client).mockResolvedValue({});
    const result = asTool(await handleToolCall(client, name, { ...args, [CONFIRM_ARG]: true }));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/No KPN mobile (contract|order) found/);
    expect(mutation(client)).not.toHaveBeenCalled();
  });

  it("SDK error on a pre-condition read → isError, no mutation", async () => {
    const client = readyClient();
    lookup(client).mockRejectedValue(new NotFoundError("Not found", 404, {}));
    const result = asTool(await handleToolCall(client, name, { ...args, [CONFIRM_ARG]: true }));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("KPN error (HTTP 404");
    expect(mutation(client)).not.toHaveBeenCalled();
  });

  it("SDK 5xx on the mutation → isError with the check-before-retry hint", async () => {
    const client = readyClient();
    mutation(client).mockRejectedValue(new ServerError("Bad gateway", 502, {}));
    const result = asTool(await handleToolCall(client, name, { ...args, [CONFIRM_ARG]: true }));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("kpn_mobile_orders_list before retrying");
    expect(mutation(client)).toHaveBeenCalledTimes(1);
  });
});

describe("SIM tools: pre-conditions and payloads", () => {
  it.each([
    ["kpn_mobile_sim_block", "blockSim"],
    ["kpn_mobile_sim_unblock", "unblockSim"],
    ["kpn_mobile_sim_replace", "replaceSim"],
  ] as const)("%s: operation not enabled → isError listing blocking orders, no mutation", async (name, op) => {
    const client = readyClient();
    mocks(client).contracts.getOperations.mockResolvedValue({
      contractId: CONTRACT_ID,
      [op]: {
        enabled: false,
        blockingOrders: [{ id: 555, kpnReference: "KPN-REF-1", status: "IN_PROGRESS" }],
      },
    });
    const args = { contractId: CONTRACT_ID, esim: true, email: "it@example.test", [CONFIRM_ARG]: true };
    const result = asTool(await handleToolCall(client, name, args));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not currently allowed");
    expect(text(result)).toContain("#555 (KPN-REF-1, IN_PROGRESS)");
    expect(mocks(client).contracts[op]).not.toHaveBeenCalled();
  });

  it("an operation missing from the availability answer counts as not enabled", async () => {
    const client = readyClient();
    mocks(client).contracts.getOperations.mockResolvedValue({ contractId: CONTRACT_ID });
    const result = asTool(
      await handleToolCall(client, "kpn_mobile_sim_block", { contractId: CONTRACT_ID, [CONFIRM_ARG]: true })
    );
    expect(result.isError).toBe(true);
    expect(mocks(client).contracts.blockSim).not.toHaveBeenCalled();
  });

  it("block sends the contract id and a default WYRE reference number", async () => {
    const client = readyClient();
    const result = await handleToolCall(client, "kpn_mobile_sim_block", {
      contractId: CONTRACT_ID,
      [CONFIRM_ARG]: true,
    });
    const body = mocks(client).contracts.blockSim.mock.calls[0][0];
    expect(body.contractId).toBe(CONTRACT_ID);
    expect(body.referenceNumber).toMatch(/^WYRE-\d{14}$/);
    const parsed = JSON.parse(text(result));
    expect(parsed.order).toEqual(SUMMARY);
    expect(parsed.note).toContain(`kpn_mobile_orders_get ${SUMMARY.id}`);
    expect(parsed.note).toContain("WaitingForAuthorization");
  });

  it("a caller-supplied reference number is passed through; > 25 chars is rejected", async () => {
    const client = readyClient();
    await handleToolCall(client, "kpn_mobile_sim_unblock", {
      contractId: CONTRACT_ID,
      referenceNumber: "TICKET-42",
      [CONFIRM_ARG]: true,
    });
    expect(mocks(client).contracts.unblockSim).toHaveBeenCalledWith({
      contractId: CONTRACT_ID,
      referenceNumber: "TICKET-42",
    });

    const tooLong = asTool(
      await handleToolCall(client, "kpn_mobile_sim_unblock", {
        contractId: CONTRACT_ID,
        referenceNumber: "X".repeat(26),
        [CONFIRM_ARG]: true,
      })
    );
    expect(tooLong.isError).toBe(true);
    expect(mocks(client).contracts.unblockSim).toHaveBeenCalledTimes(1);
  });

  it("the confirmation never contains the contract's PIN or PUK", async () => {
    const client = readyClient();
    const message = askMessage(
      await handleToolCall(client, "kpn_mobile_sim_block", { contractId: CONTRACT_ID }, FORM_CAPABLE)
    );
    expect(message).not.toContain(CONTRACT.pin);
    expect(message).not.toContain(CONTRACT.puk);
    expect(message).toContain(`contract ${CONTRACT_ID}`);
  });
});

describe("kpn_mobile_sim_replace", () => {
  const PHYSICAL = { contractId: CONTRACT_ID, esim: false, newSimCardNumber: "8931000000000000001" };

  it("invalid ICCID from the validator → isError, replaceSim never called", async () => {
    const client = readyClient();
    mocks(client).contracts.validateSimReplacement.mockRejectedValue(
      new ValidationError("SIM card number is invalid", 400, {}, "INVALID_SIM_CARD_NUMBER")
    );
    const result = asTool(
      await handleToolCall(client, "kpn_mobile_sim_replace", { ...PHYSICAL, [CONFIRM_ARG]: true })
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("INVALID_SIM_CARD_NUMBER");
    expect(text(result)).toContain("Nothing was changed.");
    expect(mocks(client).contracts.replaceSim).not.toHaveBeenCalled();
  });

  it("physical SIM: validates the ICCID before the gate and sends it", async () => {
    const client = readyClient();
    await handleToolCall(client, "kpn_mobile_sim_replace", {
      ...PHYSICAL,
      wishDate: "2026-10-01",
      [CONFIRM_ARG]: true,
    });
    expect(mocks(client).contracts.validateSimReplacement).toHaveBeenCalledWith({
      contractId: CONTRACT_ID,
      newSimCardNumber: PHYSICAL.newSimCardNumber,
    });
    const body = mocks(client).contracts.replaceSim.mock.calls[0][0];
    expect(body).toMatchObject({
      contractId: CONTRACT_ID,
      esim: false,
      newSimCardNumber: PHYSICAL.newSimCardNumber,
      wishDate: "2026-10-01",
    });
    expect(body.email).toBeUndefined();
  });

  it("eSIM: skips the ICCID validator and sends the email", async () => {
    const client = readyClient();
    const ask = await handleToolCall(
      client,
      "kpn_mobile_sim_replace",
      { contractId: CONTRACT_ID, esim: true, email: "it@example.test" },
      FORM_CAPABLE
    );
    expect(askMessage(ask)).toContain("it@example.test");

    await handleToolCall(
      client,
      "kpn_mobile_sim_replace",
      { contractId: CONTRACT_ID, esim: true, email: "it@example.test" },
      answered(true)
    );
    expect(mocks(client).contracts.validateSimReplacement).not.toHaveBeenCalled();
    const body = mocks(client).contracts.replaceSim.mock.calls[0][0];
    expect(body).toMatchObject({ contractId: CONTRACT_ID, esim: true, email: "it@example.test" });
    expect(body.newSimCardNumber).toBeUndefined();
  });

  it.each([
    [{ contractId: CONTRACT_ID }, "esim"],
    [{ contractId: CONTRACT_ID, esim: false }, "newSimCardNumber"],
    [{ contractId: CONTRACT_ID, esim: true }, "email"],
    [{ contractId: CONTRACT_ID, esim: true, email: "not-an-email" }, "email"],
    [{ ...PHYSICAL, wishDate: "01-10-2026" }, "wishDate"],
  ])("rejects %o (bad %s) before any KPN call", async (args, key) => {
    const client = readyClient();
    const result = asTool(
      await handleToolCall(client, "kpn_mobile_sim_replace", { ...args, [CONFIRM_ARG]: true })
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(key);
    expect(mocks(client).contracts.getOperations).not.toHaveBeenCalled();
    expect(mocks(client).contracts.replaceSim).not.toHaveBeenCalled();
  });
});

describe("kpn_mobile_orders_authorize", () => {
  it.each(["IN_PROGRESS", "NEW", "CLOSED", undefined])(
    "status %s (not UNAUTHORIZED) → isError, authorize never called",
    async (status) => {
      const client = readyClient();
      mocks(client).orders.get.mockResolvedValue({ ...UNAUTHORIZED_ORDER, status });
      const result = asTool(
        await handleToolCall(client, "kpn_mobile_orders_authorize", {
          orderId: ORDER_ID,
          [CONFIRM_ARG]: true,
        })
      );
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("only UNAUTHORIZED orders");
      expect(mocks(client).orders.authorize).not.toHaveBeenCalled();
    }
  );

  it("confirmation names the type, the recipient and both costs in euros", async () => {
    const client = readyClient();
    const message = askMessage(
      await handleToolCall(client, "kpn_mobile_orders_authorize", { orderId: ORDER_ID }, FORM_CAPABLE)
    );
    expect(message).toContain("New mobile line");
    expect(message).toContain("Piet Pietersen");
    expect(message).toContain("€25.00");
    expect(message).toContain("€12.99");
  });

  it("authorizes by order id", async () => {
    const client = readyClient();
    await handleToolCall(client, "kpn_mobile_orders_authorize", { orderId: ORDER_ID }, answered(true));
    expect(mocks(client).orders.authorize).toHaveBeenCalledWith(ORDER_ID);
  });
});

describe("kpn_mobile_orders_cancel", () => {
  it("cancelOrder availability present but disabled → isError, cancel never called", async () => {
    const client = readyClient();
    mocks(client).orders.get.mockResolvedValue({
      ...OPEN_ORDER,
      cancelOrder: { enabled: false, visible: true },
    });
    const result = asTool(
      await handleToolCall(client, "kpn_mobile_orders_cancel", {
        orderId: ORDER_ID,
        [CONFIRM_ARG]: true,
      })
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("cannot be cancelled");
    expect(mocks(client).orders.cancel).not.toHaveBeenCalled();
  });

  it("no cancelOrder flag in the answer → allowed", async () => {
    const client = readyClient();
    mocks(client).orders.get.mockResolvedValue({ id: ORDER_ID, status: "NEW" });
    const result = asTool(
      await handleToolCall(client, "kpn_mobile_orders_cancel", {
        orderId: ORDER_ID,
        [CONFIRM_ARG]: true,
      })
    );
    expect(result.isError).toBeUndefined();
    expect(mocks(client).orders.cancel).toHaveBeenCalledTimes(1);
  });

  it("passes the note through and reports the cancellation", async () => {
    const client = readyClient();
    const result = await handleToolCall(client, "kpn_mobile_orders_cancel", {
      orderId: CANCEL_ORDER_ID,
      note: "Ordered by mistake",
      [CONFIRM_ARG]: true,
    });
    expect(mocks(client).orders.cancel).toHaveBeenCalledWith(CANCEL_ORDER_ID, "Ordered by mistake");
    const parsed = JSON.parse(text(result));
    expect(parsed).toMatchObject({ cancelled: true, orderId: CANCEL_ORDER_ID });
  });
});
