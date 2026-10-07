/**
 * Shared handler plumbing: argument helpers, MSM paging, Dutch address and
 * phone normalization, PIN/PUK masking, error description, dispatch and the
 * core kpn_test_connection handler.
 */
import { describe, expect, it, vi } from "vitest";
import { parseKpnError } from "@wyre-ai/node-kpn/legacy";
import { normalizeNlMobile, normalizeZip } from "../handlers/addresses.js";
import { describeKpnError, handleLegacyToolCall } from "../handlers/index.js";
import { MASK, maskContract } from "../handlers/masking.js";
import { pageMeta, readPaging, toMsmPage } from "../handlers/paging.js";
import {
  optionalEnum,
  optionalStringArray,
  requireInteger,
  ToolInputError,
  type ToolResult,
} from "../handlers/results.js";
import { stubClient } from "./stub-client.js";

describe("argument helpers", () => {
  it("requireInteger accepts integers and numeric strings, rejects the rest", () => {
    expect(requireInteger({ id: 7 }, "id")).toBe(7);
    expect(requireInteger({ id: "42" }, "id")).toBe(42);
    for (const bad of [undefined, 1.5, "", "abc", null, true]) {
      expect(() => requireInteger({ id: bad }, "id")).toThrow(ToolInputError);
    }
  });

  it("optionalStringArray", () => {
    expect(optionalStringArray({}, "s")).toBeUndefined();
    expect(optionalStringArray({ s: ["a", "b"] }, "s")).toEqual(["a", "b"]);
    expect(() => optionalStringArray({ s: "a" }, "s")).toThrow(ToolInputError);
    expect(() => optionalStringArray({ s: ["a", 1] }, "s")).toThrow(ToolInputError);
  });

  it("optionalEnum", () => {
    const allowed = ["ACTIVE", "BLOCKED"] as const;
    expect(optionalEnum({}, "state", allowed)).toBeUndefined();
    expect(optionalEnum({ state: "BLOCKED" }, "state", allowed)).toBe("BLOCKED");
    expect(() => optionalEnum({ state: "blocked" }, "state", allowed)).toThrow(/ACTIVE, BLOCKED/);
  });
});

describe("MSM paging", () => {
  it("defaults to offset 0, limit 20", () => {
    expect(readPaging({})).toEqual({ offset: 0, limit: 20 });
    expect(toMsmPage({})).toEqual({ from: 0, to: 20 });
  });

  it("maps offset/limit to from/to", () => {
    expect(toMsmPage({ offset: 40, limit: 10 })).toEqual({ from: 40, to: 50 });
  });

  it("rejects a negative offset and a limit outside 1–100", () => {
    for (const args of [{ offset: -1 }, { limit: 0 }, { limit: 101 }, { limit: 2.5 }]) {
      expect(() => toMsmPage(args)).toThrow(ToolInputError);
    }
  });

  it("pageMeta reports whether more results exist", () => {
    const page = { result: [1, 2, 3], total: 10 };
    expect(pageMeta(page, 0, 3)).toEqual({
      total: 10,
      offset: 0,
      limit: 3,
      returned: 3,
      hasMore: true,
    });
    expect(pageMeta(page, 7, 3).hasMore).toBe(false);
  });
});

describe("normalizeZip", () => {
  it("uppercases and strips spaces", () => {
    expect(normalizeZip("1234 ab")).toBe("1234AB");
    expect(normalizeZip(" 9999ZZ ")).toBe("9999ZZ");
  });

  it("rejects anything that is not a Dutch postcode", () => {
    for (const bad of ["0123AB", "123AB", "1234A", "12345", "SW1A 1AA"]) {
      expect(() => normalizeZip(bad), bad).toThrow(ToolInputError);
    }
  });
});

describe("normalizeNlMobile", () => {
  it("normalizes the Dutch mobile forms to +316xxxxxxxx", () => {
    for (const input of ["0612345678", "06-1234 5678", "31612345678", "+31612345678", "+31 6 12345678"]) {
      expect(normalizeNlMobile(input), input).toBe("+31612345678");
    }
  });

  it("passes other +E.164 numbers through", () => {
    expect(normalizeNlMobile("+32470123456")).toBe("+32470123456");
  });

  it("rejects everything else", () => {
    for (const bad of ["0201234567", "612345678", "hello", "+0612345678", ""]) {
      expect(() => normalizeNlMobile(bad), bad).toThrow(ToolInputError);
    }
  });
});

describe("maskContract", () => {
  it("masks pin and puk and flags it", () => {
    const raw = { id: 1, mobileNumber: "+31600000000", pin: "1111", puk: "22222222" };
    const masked = maskContract(raw);
    expect(masked).toEqual({
      id: 1,
      mobileNumber: "+31600000000",
      pin: MASK,
      puk: MASK,
      pinPukMasked: true,
    });
    expect(raw.pin).toBe("1111"); // input untouched
  });

  it("masks nested and numbered variants", () => {
    const masked = maskContract({ sim: { PUK2: "33333333" }, items: [{ pin: "4444" }] });
    const text = JSON.stringify(masked);
    expect(text).not.toContain("33333333");
    expect(text).not.toContain("4444");
    expect(masked.pinPukMasked).toBe(true);
  });

  it("leaves details without secrets unflagged", () => {
    expect(maskContract({ id: 1, pin: null })).toEqual({ id: 1, pin: null });
  });
});

describe("describeKpnError", () => {
  it("formats status, code, message and transactionId", () => {
    const error = parseKpnError(404, {
      transactionId: "tx-1",
      status: 404,
      name: "NotFound",
      message: "Contract not found",
    });
    expect(describeKpnError(error)).toBe(
      "KPN error (HTTP 404, NotFound): Contract not found (transactionId: tx-1)"
    );
  });

  it("adds the MSM hint to 401/403 on mobile tools only", () => {
    const forbidden = parseKpnError(403, { error: { name: "Forbidden", message: "Denied" } });
    expect(describeKpnError(forbidden, "kpn_mobile_contracts_get")).toContain("GRIP-bound");
    expect(describeKpnError(forbidden, "kpn_disturbances_check")).not.toContain("GRIP-bound");
    const unauthorized = parseKpnError(401, "nope");
    expect(describeKpnError(unauthorized, "kpn_mobile_orders_list")).toContain("GRIP-bound");
  });

  it("includes retry-after and the quota reset on 429", () => {
    const error = parseKpnError(429, "slow down", new Headers({ "retry-after": "30" }));
    (error as { quota?: unknown }).quota = { resetUtc: "2026-09-25T12:00:00Z" };
    const text = describeKpnError(error);
    expect(text).toContain("retry after 30s");
    expect(text).toContain("2026-09-25T12:00:00Z");
  });

  it("tells the user to check orders before retrying a failed write", () => {
    const error = parseKpnError(502, "Bad gateway");
    expect(describeKpnError(error, "kpn_mobile_sim_block")).toContain("kpn_mobile_orders_list");
    expect(describeKpnError(error, "kpn_mobile_orders_list")).not.toContain("before retrying");
  });
});

function text(result: unknown): string {
  return (result as ToolResult).content[0].type === "text"
    ? ((result as ToolResult).content[0] as { text: string }).text
    : "";
}

describe("dispatch", () => {
  it("unknown tools are an isError result, including prototype keys", async () => {
    for (const name of ["kpn_nope", "constructor", "__proto__"]) {
      const result = (await handleLegacyToolCall(stubClient(), name, {})) as ToolResult;
      expect(result.isError, name).toBe(true);
      expect(text(result)).toContain("Unknown tool");
    }
  });

  it("maps a thrown KpnError to an isError result", async () => {
    const client = stubClient({
      testConnection: vi.fn(async () => {
        throw parseKpnError(500, "boom");
      }),
    });
    const result = (await handleLegacyToolCall(client, "kpn_test_connection", {})) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("KPN error (HTTP 500)");
  });

  it("maps invalid arguments to an isError result", async () => {
    const result = (await handleLegacyToolCall(stubClient(), "kpn_test_connection", {
      includeMsm: "yes",
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Invalid arguments for kpn_test_connection");
  });
});

describe("kpn_test_connection", () => {
  it("reports both realms, the quota and the entitlement caveat", async () => {
    const client = stubClient({
      testConnection: vi.fn(async () => ({
        gateway: { ok: true, level: "demo", applicationName: "fake-app" },
        msm: { ok: true, level: "demo", applicationName: "fake-msm-app" },
      })),
      lastQuota: { limit: 100, used: 3 },
    });
    const result = (await handleLegacyToolCall(client, "kpn_test_connection", {})) as ToolResult;
    expect(result.isError).toBeUndefined();
    expect(client.testConnection).toHaveBeenCalledWith({ includeMsm: true });
    const body = JSON.parse(text(result));
    expect(body.gateway.level).toBe("demo");
    expect(body.msm.ok).toBe(true);
    expect(body.quota).toEqual({ limit: 100, used: 3 });
    expect(body.note).toContain("developer.kpn.com");
  });

  it("skips MSM when includeMsm is false", async () => {
    const client = stubClient();
    await handleLegacyToolCall(client, "kpn_test_connection", { includeMsm: false });
    expect(client.testConnection).toHaveBeenCalledWith({ includeMsm: false });
  });

  it("an MSM failure is reported, not fatal", async () => {
    const client = stubClient({
      testConnection: vi.fn(async () => ({
        gateway: { ok: true, level: "prod" },
        msm: { ok: false, error: "ClientId is Invalid" },
      })),
    });
    const result = (await handleLegacyToolCall(client, "kpn_test_connection", {})) as ToolResult;
    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain("GRIP-bound");
  });

  it("a gateway failure is an isError result", async () => {
    const client = stubClient({
      testConnection: vi.fn(async () => ({ gateway: { ok: false, error: "ClientId is Invalid" } })),
    });
    const result = (await handleLegacyToolCall(client, "kpn_test_connection", {})) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("ClientId is Invalid");
  });
});
