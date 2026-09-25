/**
 * Handler tests for tools 2–4 (disturbances, availability, SIM swap) against
 * the stub client. All three are plain reads: no elicitation gate.
 */
import { describe, expect, it, vi } from "vitest";
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import {
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from "@wyre-ai/node-kpn";
import { handleToolCall } from "../handlers/index.js";
import { stripHtml } from "../handlers/network.js";
import type { ToolResult } from "../handlers/results.js";
import { stubClient } from "./stub-client.js";

/** Narrow a handler result to a plain tool result (i.e. not an MRTR ask). */
function asTool(result: ToolResult | InputRequiredResult): ToolResult {
  expect((result as { resultType?: string }).resultType).toBeUndefined();
  return result as ToolResult;
}

function text(result: ToolResult | InputRequiredResult): string {
  const content = asTool(result).content[0];
  return content.type === "text" ? content.text : "";
}

function parse(result: ToolResult | InputRequiredResult): Record<string, unknown> {
  const tool = asTool(result);
  expect(tool.isError).toBeFalsy();
  return JSON.parse(text(tool));
}

const ADDRESS = { zipCode: "1234 ab", houseNumber: 12 };

// Fictional data only.
const OUTAGE = {
  id: 42,
  type: "generic",
  cause: "disturbance",
  service: "Internet",
  state: "open",
  description: "Storing internet",
  long_description: "<p>We werken aan een <b>storing</b>&nbsp;in uw regio.</p>",
};

describe("kpn_disturbances_check", () => {
  it("normalizes the address and returns a summary with HTML stripped", async () => {
    const client = stubClient({
      disturbances: {
        getByAddress: vi.fn(async () => ({
          broadband: [OUTAGE],
          fixed: [],
          mobile: [{ id: 43, state: "closed" }],
          generic: [],
        })),
      },
    });
    const result = await handleToolCall(client, "kpn_disturbances_check", {
      ...ADDRESS,
      houseNumberExtension: " A ",
    });
    expect(client.disturbances.getByAddress).toHaveBeenCalledWith({
      zipCode: "1234AB",
      houseNumber: 12,
      houseNumberExtension: "A",
    });
    const payload = parse(result) as {
      summary: Record<string, unknown>;
      broadband: Array<{ long_description: string }>;
    };
    expect(payload.summary).toEqual({
      total: 2,
      open: 1,
      byCategory: { broadband: 1, fixed: 0, mobile: 1, generic: 0 },
    });
    expect(payload.broadband[0].long_description).toBe("We werken aan een storing in uw regio.");
  });

  it("no disturbances is a success with an explicit message", async () => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, "kpn_disturbances_check", ADDRESS));
    expect(result.isError).toBeFalsy();
    expect(text(result)).toBe("No known KPN disturbances at this address.\nAddress: 1234AB 12");
  });

  it("address alerts → isError", async () => {
    const client = stubClient({
      disturbances: {
        getByAddress: vi.fn(async () => ({
          broadband: [],
          fixed: [],
          mobile: [],
          generic: [],
          alerts: [{ code: "ADDRESS_NOT_FOUND", description: "Address unknown" }],
        })),
      },
    });
    const result = asTool(await handleToolCall(client, "kpn_disturbances_check", ADDRESS));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("ADDRESS_NOT_FOUND: Address unknown");
  });

  it.each([
    [{ houseNumber: 12 }, '"zipCode"'],
    [{ zipCode: "ABCD12", houseNumber: 12 }, "not a Dutch postcode"],
    [{ zipCode: "1234AB" }, '"houseNumber"'],
    [{ zipCode: "1234AB", houseNumber: 0 }, '"houseNumber"'],
  ])("invalid arguments %j → isError, no KPN call", async (args, message) => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, "kpn_disturbances_check", args));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(message);
    expect(client.disturbances.getByAddress).not.toHaveBeenCalled();
  });

  it("SDK error → isError with the KPN description", async () => {
    const client = stubClient({
      disturbances: {
        getByAddress: vi.fn(async () => {
          throw new AuthenticationError("Invalid access token", 401, {}, "oauth.v2.InvalidAccessToken");
        }),
      },
    });
    const result = asTool(await handleToolCall(client, "kpn_disturbances_check", ADDRESS));
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "KPN error (HTTP 401, oauth.v2.InvalidAccessToken): Invalid access token"
    );
  });
});

describe("kpn_availability_check", () => {
  const AVAILABLE = {
    available_on_address: { technologies: [{ name: "FIBER", download: 1000, upload: 1000 }] },
    fixed_info: { fiber_access: true, copper_access: true },
    bandwidth: { down: 1000, up: 1000 },
    alerts: [],
  };

  it("returns the availability info without the empty alerts", async () => {
    const client = stubClient({ availability: { getByAddress: vi.fn(async () => AVAILABLE) } });
    const payload = parse(await handleToolCall(client, "kpn_availability_check", ADDRESS));
    expect(client.availability.getByAddress).toHaveBeenCalledWith({
      zipCode: "1234AB",
      houseNumber: 12,
    });
    expect(payload).toEqual({
      address: "1234AB 12",
      available_on_address: AVAILABLE.available_on_address,
      fixed_info: AVAILABLE.fixed_info,
      bandwidth: AVAILABLE.bandwidth,
    });
  });

  it("address alerts → isError that offers the valid extensions", async () => {
    const client = stubClient({
      availability: {
        getByAddress: vi.fn(async () => ({
          available_on_address: { house_number_extensions: ["A", "B"] },
          alerts: [{ code: "AMBIGUOUS", description: "Extension required" }],
        })),
      },
    });
    const result = asTool(await handleToolCall(client, "kpn_availability_check", ADDRESS));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("AMBIGUOUS: Extension required");
    expect(text(result)).toContain("Valid house number extensions: A, B.");
  });

  it("empty result → isError", async () => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, "kpn_availability_check", ADDRESS));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("No KPN availability information found");
  });

  it("invalid postcode → isError, no KPN call", async () => {
    const client = stubClient();
    const result = asTool(
      await handleToolCall(client, "kpn_availability_check", { zipCode: "0123AB", houseNumber: 1 })
    );
    expect(result.isError).toBe(true);
    expect(client.availability.getByAddress).not.toHaveBeenCalled();
  });

  it("SDK error → isError with the quota reset time on a 429", async () => {
    const error = new RateLimitError("Quota exceeded", 429, {});
    error.retryAfter = 7;
    error.quota = { resetUtc: "2026-09-25T12:00:00Z" };
    const client = stubClient({
      availability: {
        getByAddress: vi.fn(async () => {
          throw error;
        }),
      },
    });
    const result = asTool(await handleToolCall(client, "kpn_availability_check", ADDRESS));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("retry after 7s");
    expect(text(result)).toContain("2026-09-25T12:00:00Z");
  });
});

describe("kpn_sim_swap_get_date", () => {
  const HOUR = 3_600_000;
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

  it("normalizes 06… to E.164 and reports the swap age", async () => {
    const swappedAt = hoursAgo(10);
    const client = stubClient({
      simSwap: { retrieveDate: vi.fn(async () => ({ latestSimChange: swappedAt })) },
    });
    const payload = parse(
      await handleToolCall(client, "kpn_sim_swap_get_date", { phoneNumber: "06 1234 5678" })
    );
    expect(client.simSwap.retrieveDate).toHaveBeenCalledWith("+31612345678");
    expect(payload).toEqual({
      phoneNumber: "+31612345678",
      latestSimChange: swappedAt,
      hoursSinceSimChange: 10,
    });
  });

  it.each([
    [24, true],
    [5, false],
  ])("maxAgeHours %i adds swappedWithinMaxAge = %s", async (maxAgeHours, expected) => {
    const client = stubClient({
      simSwap: { retrieveDate: vi.fn(async () => ({ latestSimChange: hoursAgo(10) })) },
    });
    const payload = parse(
      await handleToolCall(client, "kpn_sim_swap_get_date", {
        phoneNumber: "+31612345678",
        maxAgeHours,
      })
    );
    expect(payload.swappedWithinMaxAge).toBe(expected);
  });

  it("no SIM-swap date → isError (not proof of no swap)", async () => {
    const client = stubClient();
    const result = asTool(
      await handleToolCall(client, "kpn_sim_swap_get_date", { phoneNumber: "0612345678" })
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("could not be verified");
  });

  it("404 SIM_SWAP.UNKNOWN_PHONE_NUMBER → 'not a KPN mobile number'", async () => {
    const client = stubClient({
      simSwap: {
        retrieveDate: vi.fn(async () => {
          throw new NotFoundError("Unknown phone number", 404, {}, "SIM_SWAP.UNKNOWN_PHONE_NUMBER");
        }),
      },
    });
    const result = asTool(
      await handleToolCall(client, "kpn_sim_swap_get_date", { phoneNumber: "+31612345678" })
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not a KPN mobile number or unknown");
  });

  it("other SDK errors → isError via describeKpnError", async () => {
    const client = stubClient({
      simSwap: {
        retrieveDate: vi.fn(async () => {
          throw new ServerError("Bad gateway", 502, "", undefined, "tx-fake-1");
        }),
      },
    });
    const result = asTool(
      await handleToolCall(client, "kpn_sim_swap_get_date", { phoneNumber: "+31612345678" })
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("KPN error (HTTP 502): Bad gateway (transactionId: tx-fake-1)");
  });

  it.each([
    [{}, '"phoneNumber"'],
    [{ phoneNumber: "12345" }, "not a mobile number"],
    [{ phoneNumber: "0612345678", maxAgeHours: 0 }, '"maxAgeHours"'],
    [{ phoneNumber: "0612345678", maxAgeHours: 1.5 }, '"maxAgeHours"'],
  ])("invalid arguments %j → isError, no KPN call", async (args, message) => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, "kpn_sim_swap_get_date", args));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(message);
    expect(client.simSwap.retrieveDate).not.toHaveBeenCalled();
  });
});

describe("stripHtml", () => {
  it("turns paragraphs and line breaks into newlines and decodes entities", () => {
    expect(stripHtml("<p>Een &amp; twee</p><p>drie<br/>vier</p>")).toBe("Een & twee\ndrie\nvier");
  });
});
