/**
 * Handler tests for tools 5–18 (MSM reads) against the stub client. Every
 * tool gets a happy path, an invalid-argument path, an SDK error mapped to
 * isError, and an empty result mapped to isError (design.md §6). The gated
 * PUK tool additionally covers all four confirmDestructive outcomes.
 */
import { describe, expect, it, vi, type Mock } from "vitest";
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import {
  ForbiddenError,
  NotFoundError,
  ServerError,
  ValidationError,
} from "@wyre-technology/node-kpn";
import { CONFIRM_ARG, type ElicitationContext } from "../elicitation.js";
import { handleToolCall } from "../handlers/index.js";
import type { ToolResult } from "../handlers/results.js";
import { stubClient, type StubTree } from "./stub-client.js";

// ── Fixtures (fictional) ───────────────────────────────────────────────────

const FAKE_PIN = "4821";
const FAKE_PUK = "73915064";

const CONTRACT_DETAILS = {
  id: 5001,
  phoneNumber: "+31600000001",
  simCardNumber: "8931000000000000001",
  imei: "350000000000001",
  userPrincipalName: "j.test@example.nl",
  status: "ACTIVE",
  pin: FAKE_PIN,
  puk: FAKE_PUK,
};

const CONTRACT_ROW = { id: 5001, mobileNumber: "0600000001", state: "ACTIVE" };
const page = <T>(result: T[], total = result.length) => ({ result, total });

const FORM_CAPABLE: ElicitationContext = { clientCapabilities: { elicitation: {} } };

function answered(content: Record<string, unknown>, action = "accept"): ElicitationContext {
  return {
    clientCapabilities: { elicitation: {} },
    inputResponses: { confirm: { action, content } },
  };
}

// ── Result helpers ─────────────────────────────────────────────────────────

/** Narrow a handler result to a plain tool result (i.e. not an MRTR ask). */
function asTool(result: ToolResult | InputRequiredResult): ToolResult {
  expect((result as { resultType?: string }).resultType).toBeUndefined();
  return result as ToolResult;
}

function text(result: ToolResult | InputRequiredResult): string {
  const first = asTool(result).content[0];
  return first.type === "text" ? first.text : "";
}

function parse(result: ToolResult | InputRequiredResult): Record<string, unknown> {
  expect(asTool(result).isError).toBeFalsy();
  return JSON.parse(text(result));
}

function expectError(result: ToolResult | InputRequiredResult, pattern: RegExp): void {
  expect(asTool(result).isError).toBe(true);
  expect(text(result)).toMatch(pattern);
}

const notFound = () => new NotFoundError("Not found", 404, {}, "NOT_FOUND");
const forbidden = () => new ForbiddenError("Forbidden", 403, {});

// ── Common paths, table-driven ─────────────────────────────────────────────

/**
 * For each tool: valid args, invalid args, and how to make the SDK call fail
 * or come back empty. `sdk` picks the stub method the tool calls first.
 */
interface Case {
  tool: string;
  args: Record<string, unknown>;
  invalid: Record<string, unknown>;
  sdk: (c: StubTree) => Mock;
  empty: unknown;
  emptyMessage: RegExp;
}

const CASES: Case[] = [
  {
    tool: "kpn_mobile_subscribers_list",
    args: {},
    invalid: { limit: 500 },
    sdk: (c) => c.mobile.subscribers.list,
    empty: page([]),
    emptyMessage: /No subscribers found/,
  },
  {
    tool: "kpn_mobile_subscribers_get",
    args: { id: 1 },
    invalid: { id: "abc" },
    sdk: (c) => c.mobile.subscribers.get,
    empty: {},
    emptyMessage: /No subscriber found with id 1/,
  },
  {
    tool: "kpn_mobile_contracts_list",
    args: {},
    invalid: { state: "LOST" },
    sdk: (c) => c.mobile.contracts.list,
    empty: page([]),
    emptyMessage: /No contracts found/,
  },
  {
    tool: "kpn_mobile_contracts_get",
    args: { id: 5001 },
    invalid: {},
    sdk: (c) => c.mobile.contracts.get,
    empty: {},
    emptyMessage: /No contract found with id 5001/,
  },
  {
    tool: "kpn_mobile_contracts_get_puk",
    args: { id: 5001, [CONFIRM_ARG]: true },
    invalid: { id: 1.5 },
    sdk: (c) => c.mobile.contracts.get,
    empty: {},
    emptyMessage: /No contract found with id 5001/,
  },
  {
    tool: "kpn_mobile_contracts_get_operations",
    args: { contractId: 5001 },
    invalid: { id: 5001 },
    sdk: (c) => c.mobile.contracts.getOperations,
    empty: {},
    emptyMessage: /No operations information found for contract 5001/,
  },
  {
    tool: "kpn_mobile_orders_list",
    args: {},
    invalid: { status: ["HOLD_CUS"] },
    sdk: (c) => c.mobile.orders.list,
    empty: page([]),
    emptyMessage: /No orders found with status NEW, IN_PROGRESS, UNAUTHORIZED/,
  },
  {
    tool: "kpn_mobile_orders_get",
    args: { id: 7001 },
    invalid: { id: null },
    sdk: (c) => c.mobile.orders.getPretty,
    empty: {},
    emptyMessage: /No order found with id 7001/,
  },
  {
    tool: "kpn_mobile_service_requests_list",
    args: {},
    invalid: { status: "NEW" },
    sdk: (c) => c.mobile.serviceRequests.list,
    empty: page([]),
    emptyMessage: /No service requests found/,
  },
  {
    tool: "kpn_mobile_service_requests_get",
    args: { id: 8001 },
    invalid: { id: true },
    sdk: (c) => c.mobile.serviceRequests.get,
    empty: {},
    emptyMessage: /No service request found with id 8001/,
  },
  {
    tool: "kpn_mobile_invoices_list",
    args: {},
    invalid: { searchFrom: "01-01-2026" },
    sdk: (c) => c.mobile.invoices.list,
    empty: page([]),
    emptyMessage: /No invoices found/,
  },
  {
    tool: "kpn_mobile_invoices_get_pdf",
    args: { id: 9001 },
    invalid: {},
    sdk: (c) => c.mobile.invoices.downloadPdf,
    empty: { data: new Uint8Array(), contentType: "application/pdf" },
    emptyMessage: /No PDF found for invoice 9001/,
  },
  {
    tool: "kpn_mobile_hierarchy_list",
    args: {},
    invalid: { parentId: "root" },
    sdk: (c) => c.mobile.hierarchy.listChildren,
    empty: page([]),
    emptyMessage: /No hierarchy items found/,
  },
  {
    tool: "kpn_mobile_thresholds_list",
    args: {},
    invalid: { offset: -1 },
    sdk: (c) => c.mobile.thresholds.list,
    empty: [],
    emptyMessage: /No thresholds found/,
  },
];

describe.each(CASES)("$tool — common paths", (tc) => {
  it("rejects invalid arguments without calling KPN", async () => {
    const client = stubClient();
    const result = await handleToolCall(client, tc.tool, tc.invalid);
    expectError(result, new RegExp(`Invalid arguments for ${tc.tool}`));
    expect(tc.sdk(client)).not.toHaveBeenCalled();
  });

  it("maps an SDK error to isError with the MSM hint", async () => {
    const client = stubClient();
    tc.sdk(client).mockRejectedValue(forbidden());
    const result = await handleToolCall(client, tc.tool, tc.args);
    expectError(result, /KPN error \(HTTP 403\): Forbidden.*GRIP-bound MSM app/);
  });

  it("reports an empty result as isError", async () => {
    const client = stubClient();
    tc.sdk(client).mockResolvedValue(tc.empty);
    const result = await handleToolCall(client, tc.tool, tc.args);
    expectError(result, tc.emptyMessage);
  });
});

// ── Happy paths and tool-specific behaviour ────────────────────────────────

describe("kpn_mobile_subscribers_list", () => {
  it("maps search, filters and paging to the SDK call", async () => {
    const client = stubClient({
      mobile: { subscribers: { list: vi.fn(async () => page([{ id: 1, firstName: "Jan" }], 41)) } },
    });
    const out = parse(
      await handleToolCall(client, "kpn_mobile_subscribers_list", {
        search: "jan",
        firstName: "Jan",
        employeeNumber: "E-001",
        offset: 20,
        limit: 10,
      })
    );
    expect(client.mobile.subscribers.list).toHaveBeenCalledWith({
      from: 20,
      to: 30,
      patterns: ["jan"],
      filters: 'FIRSTNAME: "Jan"; EMPLOYEE_NUMBER: "E-001"',
    });
    expect(out).toMatchObject({ total: 41, offset: 20, limit: 10, returned: 1, hasMore: true });
    expect(out.subscribers).toEqual([{ id: 1, firstName: "Jan" }]);
  });

  it("says when the offset is past the end", async () => {
    const client = stubClient({
      mobile: { subscribers: { list: vi.fn(async () => page([], 5)) } },
    });
    const result = await handleToolCall(client, "kpn_mobile_subscribers_list", { offset: 40 });
    expectError(result, /No subscribers found at offset 40; there are 5 in total/);
  });
});

describe("kpn_mobile_subscribers_get", () => {
  it("includes the subscriber's contracts by default", async () => {
    const client = stubClient({
      mobile: {
        subscribers: {
          get: vi.fn(async () => ({ id: 1, firstName: "Jan", surname: "Test" })),
          listContracts: vi.fn(async () => page([CONTRACT_ROW])),
        },
      },
    });
    const out = parse(await handleToolCall(client, "kpn_mobile_subscribers_get", { id: 1 }));
    expect(client.mobile.subscribers.listContracts).toHaveBeenCalledWith(1, { from: 0, to: 100 });
    expect(out).toMatchObject({ id: 1, contracts: [CONTRACT_ROW], contractsTotal: 1 });
  });

  it("skips contracts when includeContracts is false", async () => {
    const client = stubClient();
    parse(
      await handleToolCall(client, "kpn_mobile_subscribers_get", { id: 1, includeContracts: false })
    );
    expect(client.mobile.subscribers.listContracts).not.toHaveBeenCalled();
  });
});

describe("kpn_mobile_contracts_list", () => {
  it("builds the filters DSL from the named arguments", async () => {
    const client = stubClient({
      mobile: { contracts: { list: vi.fn(async () => page([CONTRACT_ROW])) } },
    });
    const out = parse(
      await handleToolCall(client, "kpn_mobile_contracts_list", {
        mobileNumber: "0600000001",
        simCardNumber: "8931000000000000001",
        state: "ACTIVE",
      })
    );
    expect(client.mobile.contracts.list).toHaveBeenCalledWith({
      from: 0,
      to: 20,
      patterns: undefined,
      filters:
        'MOBILE_NUMBER: "0600000001"; SIM_CARD_NUMBER: "8931000000000000001"; STATE: "ACTIVE"',
    });
    expect(out.contracts).toEqual([CONTRACT_ROW]);
  });

  it("lists one subscriber's contracts when subscriberId is set", async () => {
    const client = stubClient({
      mobile: { subscribers: { listContracts: vi.fn(async () => page([CONTRACT_ROW])) } },
    });
    parse(await handleToolCall(client, "kpn_mobile_contracts_list", { subscriberId: 12 }));
    expect(client.mobile.subscribers.listContracts).toHaveBeenCalledWith(12, { from: 0, to: 20 });
    expect(client.mobile.contracts.list).not.toHaveBeenCalled();
  });

  it("refuses subscriberId combined with filters rather than ignoring them", async () => {
    const client = stubClient();
    const result = await handleToolCall(client, "kpn_mobile_contracts_list", {
      subscriberId: 12,
      imei: "350000000000001",
    });
    expectError(result, /cannot be combined/);
    expect(client.mobile.subscribers.listContracts).not.toHaveBeenCalled();
  });
});

describe("kpn_mobile_contracts_get", () => {
  it("never returns the fixture's PIN or PUK", async () => {
    const client = stubClient({
      mobile: { contracts: { get: vi.fn(async () => ({ ...CONTRACT_DETAILS })) } },
    });
    const result = await handleToolCall(client, "kpn_mobile_contracts_get", { id: 5001 });
    const raw = text(result);
    expect(raw).not.toContain(FAKE_PIN);
    expect(raw).not.toContain(FAKE_PUK);
    expect(parse(result)).toMatchObject({ id: 5001, pin: "••••", puk: "••••", pinPukMasked: true });
  });

  it("adds the item tree when includeItems is true, still masked", async () => {
    const items = [{ id: 1, name: { en: "Data bundle" } }];
    const client = stubClient({
      mobile: {
        contracts: {
          get: vi.fn(async () => ({ ...CONTRACT_DETAILS })),
          getItems: vi.fn(async () => items),
        },
      },
    });
    const result = await handleToolCall(client, "kpn_mobile_contracts_get", {
      id: 5001,
      includeItems: true,
    });
    expect(text(result)).not.toContain(FAKE_PUK);
    expect(parse(result).items).toEqual(items);
    expect(client.mobile.contracts.getItems).toHaveBeenCalledWith(5001);
  });

  it("maps a 404 to isError", async () => {
    const client = stubClient({ mobile: { contracts: { get: vi.fn(async () => { throw notFound(); }) } } });
    const result = await handleToolCall(client, "kpn_mobile_contracts_get", { id: 5001 });
    expectError(result, /KPN error \(HTTP 404, NOT_FOUND\)/);
  });
});

describe("kpn_mobile_contracts_get_puk (tier S gate)", () => {
  const withContract = () =>
    stubClient({ mobile: { contracts: { get: vi.fn(async () => ({ ...CONTRACT_DETAILS })) } } });

  it("form-capable client with no answer → input_required naming the target, no PUK", async () => {
    const result = await handleToolCall(withContract(), "kpn_mobile_contracts_get_puk", { id: 5001 }, FORM_CAPABLE);
    expect((result as InputRequiredResult).resultType).toBe("input_required");
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("+31600000001");
    expect(serialized).toContain("contract 5001");
    expect(serialized).not.toContain(FAKE_PUK);
  });

  it("accepted → returns only contractId, phoneNumber and puk", async () => {
    const client = withContract();
    const out = parse(
      await handleToolCall(client, "kpn_mobile_contracts_get_puk", { id: 5001 }, answered({ confirm: true }))
    );
    expect(out).toEqual({ contractId: 5001, phoneNumber: "+31600000001", puk: FAKE_PUK });
    expect(client.mobile.contracts.get).toHaveBeenCalledTimes(1);
  });

  it("declined → cancelled, PUK not revealed", async () => {
    const result = await handleToolCall(
      withContract(),
      "kpn_mobile_contracts_get_puk",
      { id: 5001 },
      answered({}, "decline")
    );
    expect(asTool(result).isError).toBeFalsy();
    expect(text(result)).toBe("Cancelled; nothing was changed.");
  });

  it("accepted with confirm: false → cancelled, PUK not revealed", async () => {
    const result = await handleToolCall(
      withContract(),
      "kpn_mobile_contracts_get_puk",
      { id: 5001 },
      answered({ confirm: false })
    );
    expect(text(result)).not.toContain(FAKE_PUK);
  });

  it("no elicitation and no confirm argument → blocked, PUK not revealed", async () => {
    const result = await handleToolCall(withContract(), "kpn_mobile_contracts_get_puk", { id: 5001 });
    expectError(result, new RegExp(`re-invoke this tool with "${CONFIRM_ARG}": true`));
    expect(text(result)).not.toContain(FAKE_PUK);
  });

  it("no elicitation but confirm argument → returns the PUK", async () => {
    const out = parse(
      await handleToolCall(withContract(), "kpn_mobile_contracts_get_puk", { id: 5001, [CONFIRM_ARG]: true })
    );
    expect(out.puk).toBe(FAKE_PUK);
  });

  it("a contract without a PUK is an error, before any prompt", async () => {
    const client = stubClient({ mobile: { contracts: { get: vi.fn(async () => ({ id: 5001 })) } } });
    const result = await handleToolCall(client, "kpn_mobile_contracts_get_puk", { id: 5001 }, FORM_CAPABLE);
    expectError(result, /No PUK is available for contract 5001/);
  });
});

describe("kpn_mobile_contracts_get_operations", () => {
  it("returns the operations availability", async () => {
    const ops = { contractId: 5001, blockSim: { enabled: true, visible: true } };
    const client = stubClient({ mobile: { contracts: { getOperations: vi.fn(async () => ops) } } });
    const out = parse(
      await handleToolCall(client, "kpn_mobile_contracts_get_operations", { contractId: 5001 })
    );
    expect(out).toEqual(ops);
    expect(client.mobile.contracts.getOperations).toHaveBeenCalledWith(5001);
  });
});

describe("kpn_mobile_orders_list", () => {
  it("defaults to open statuses and puts required actions first", async () => {
    const client = stubClient({
      mobile: { orders: { list: vi.fn(async () => page([{ id: 7001, status: "UNAUTHORIZED" }])) } },
    });
    const out = parse(await handleToolCall(client, "kpn_mobile_orders_list", {}));
    expect(client.mobile.orders.list).toHaveBeenCalledWith({
      from: 0,
      to: 20,
      status: ["NEW", "IN_PROGRESS", "UNAUTHORIZED"],
      patterns: undefined,
      currentUserOrdersOnly: undefined,
      withRequiredActionFirst: true,
    });
    expect(out.orders).toHaveLength(1);
  });

  it("passes explicit statuses, search and currentUserOnly", async () => {
    const client = stubClient({
      mobile: { orders: { list: vi.fn(async () => page([{ id: 7001 }])) } },
    });
    parse(
      await handleToolCall(client, "kpn_mobile_orders_list", {
        status: ["CLOSED", "HOLD_CUSTOMER"],
        search: "WYRE-",
        currentUserOnly: true,
      })
    );
    expect(client.mobile.orders.list).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ["CLOSED", "HOLD_CUSTOMER"],
        patterns: ["WYRE-"],
        currentUserOrdersOnly: true,
      })
    );
  });
});

describe("kpn_mobile_orders_get", () => {
  it("returns the pretty view with any pin/puk masked", async () => {
    const pretty = { id: 7001, sim: { pin: FAKE_PIN, puk: FAKE_PUK } };
    const client = stubClient({ mobile: { orders: { getPretty: vi.fn(async () => pretty) } } });
    const result = await handleToolCall(client, "kpn_mobile_orders_get", { id: 7001 });
    expect(text(result)).not.toContain(FAKE_PUK);
    expect(parse(result)).toMatchObject({ id: 7001, pinPukMasked: true });
    expect(client.mobile.orders.get).not.toHaveBeenCalled();
  });

  it.each([
    ["404", notFound],
    ["5xx", () => new ServerError("Bad gateway", 502, {})],
  ])("falls back to the typed view when /pretty fails with %s", async (_label, makeError) => {
    const client = stubClient({
      mobile: {
        orders: {
          getPretty: vi.fn(async () => { throw makeError(); }),
          get: vi.fn(async () => ({ id: 7001, status: "IN_PROGRESS" })),
        },
      },
    });
    const out = parse(await handleToolCall(client, "kpn_mobile_orders_get", { id: 7001 }));
    expect(out).toEqual({ id: 7001, status: "IN_PROGRESS" });
    expect(client.mobile.orders.get).toHaveBeenCalledWith(7001);
  });

  it("does not fall back on other errors", async () => {
    const client = stubClient({
      mobile: { orders: { getPretty: vi.fn(async () => { throw forbidden(); }) } },
    });
    const result = await handleToolCall(client, "kpn_mobile_orders_get", { id: 7001 });
    expectError(result, /HTTP 403/);
    expect(client.mobile.orders.get).not.toHaveBeenCalled();
  });
});

describe("kpn_mobile_service_requests_list / _get", () => {
  it("lists with the default open statuses", async () => {
    const client = stubClient({
      mobile: { serviceRequests: { list: vi.fn(async () => page([{ id: 8001 }])) } },
    });
    const out = parse(await handleToolCall(client, "kpn_mobile_service_requests_list", { limit: 5 }));
    expect(client.mobile.serviceRequests.list).toHaveBeenCalledWith({
      from: 0,
      to: 5,
      status: ["NEW", "IN_PROGRESS", "UNAUTHORIZED"],
      patterns: undefined,
      currentUserOrdersOnly: undefined,
    });
    expect(out.serviceRequests).toEqual([{ id: 8001 }]);
  });

  it("gets one service request", async () => {
    const client = stubClient({
      mobile: { serviceRequests: { get: vi.fn(async () => ({ id: 8001, status: "CLOSED" })) } },
    });
    const out = parse(await handleToolCall(client, "kpn_mobile_service_requests_get", { id: 8001 }));
    expect(out).toEqual({ id: 8001, status: "CLOSED" });
  });
});

describe("kpn_mobile_invoices_list", () => {
  it("passes the filters and adds the euro amount", async () => {
    const client = stubClient({
      mobile: {
        invoices: {
          list: vi.fn(async () => page([{ id: 9001, totalAmountToPayInCents: 12345 }])),
        },
      },
    });
    const out = parse(
      await handleToolCall(client, "kpn_mobile_invoices_list", {
        debtorId: 3,
        searchFrom: "2026-01-01",
        searchTo: "2026-06-30",
      })
    );
    expect(client.mobile.invoices.list).toHaveBeenCalledWith({
      from: 0,
      to: 20,
      debtorId: 3,
      searchFrom: "2026-01-01",
      searchTo: "2026-06-30",
    });
    expect(out.invoices).toEqual([{ id: 9001, totalAmountToPayInCents: 12345, totalAmountToPay: 123.45 }]);
  });
});

describe("kpn_mobile_invoices_get_pdf", () => {
  it("returns the PDF as an embedded base64 resource", async () => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, "kpn_mobile_invoices_get_pdf", { id: 9001 }));
    expect(result.isError).toBeFalsy();
    expect(result.content[1]).toEqual({
      type: "resource",
      resource: {
        uri: "kpn://invoices/9001.pdf",
        mimeType: "application/pdf",
        blob: Buffer.from("%PDF").toString("base64"),
      },
    });
    expect(client.mobile.invoices.downloadPdf).toHaveBeenCalledWith(9001);
  });

  it("refuses a PDF over 4 MB", async () => {
    const client = stubClient({
      mobile: {
        invoices: {
          downloadPdf: vi.fn(async () => ({
            data: new Uint8Array(4 * 1024 * 1024 + 1),
            contentType: "application/pdf",
          })),
        },
      },
    });
    const result = await handleToolCall(client, "kpn_mobile_invoices_get_pdf", { id: 9001 });
    expectError(result, /over the 4 MB limit/);
  });
});

describe("kpn_mobile_hierarchy_list", () => {
  it("lists children with customer and groups included", async () => {
    const client = stubClient({
      mobile: { hierarchy: { listChildren: vi.fn(async () => page([{ id: 3, type: "DEBTOR" }])) } },
    });
    const out = parse(
      await handleToolCall(client, "kpn_mobile_hierarchy_list", { parentId: 2, search: "sales" })
    );
    expect(client.mobile.hierarchy.listChildren).toHaveBeenCalledWith({
      from: 0,
      to: 20,
      id: 2,
      pattern: "sales",
      includeCustomer: true,
      includeGroups: true,
    });
    expect(out.items).toEqual([{ id: 3, type: "DEBTOR" }]);
  });

  it("names the parent in the empty message", async () => {
    const result = await handleToolCall(stubClient(), "kpn_mobile_hierarchy_list", { parentId: 2 });
    expectError(result, /No hierarchy items found under hierarchy item 2/);
  });
});

describe("kpn_mobile_thresholds_list", () => {
  it("pages the unpaged thresholds list locally", async () => {
    const all = [1, 2, 3].map((id) => ({ id, type: "DATA_ROAMING_MB" }));
    const client = stubClient({ mobile: { thresholds: { list: vi.fn(async () => all) } } });
    const out = parse(
      await handleToolCall(client, "kpn_mobile_thresholds_list", { offset: 1, limit: 1 })
    );
    expect(out).toMatchObject({ total: 3, returned: 1, hasMore: true, thresholds: [{ id: 2 }] });
  });

  it("lists a threshold's contracts when thresholdId is set", async () => {
    const client = stubClient({
      mobile: { thresholds: { listContracts: vi.fn(async () => page([CONTRACT_ROW])) } },
    });
    const out = parse(
      await handleToolCall(client, "kpn_mobile_thresholds_list", { thresholdId: 4 })
    );
    expect(client.mobile.thresholds.listContracts).toHaveBeenCalledWith(4, { from: 0, to: 20 });
    expect(client.mobile.thresholds.list).not.toHaveBeenCalled();
    expect(out.contracts).toEqual([CONTRACT_ROW]);
  });

  it("maps a validation error from KPN", async () => {
    const client = stubClient({
      mobile: {
        thresholds: {
          listContracts: vi.fn(async () => { throw new ValidationError("Bad threshold", 400, {}, "INVALID_ID"); }),
        },
      },
    });
    const result = await handleToolCall(client, "kpn_mobile_thresholds_list", { thresholdId: 4 });
    expectError(result, /KPN error \(HTTP 400, INVALID_ID\): Bad threshold/);
  });
});
