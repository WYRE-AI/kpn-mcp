/** Confirmation flags and ambiguous SDK write failures must fail safely. */
import { describe, expect, it, vi } from "vitest";
import { GrexxError, type GrexxClient } from "@wyre-ai/node-kpn";
import { CONFIRM_ARG } from "../elicitation.js";
import { callRealtime } from "../handlers/grexx-realtime.js";
import { describeGrexxError, handleGrexxToolCall } from "../handlers/index.js";
import { GREXX_REALTIME_SPECS, realtimeTool } from "../tools/grexx-realtime.js";

const CUSTOM_PRICE = GREXX_REALTIME_SPECS.find((spec) => spec.tool === "kpn_grexx_custom_price")!;
const CONFIRM_ONLY = { ...CUSTOM_PRICE, destructive: false, confirm: true };
const ARGS = { orderId: 123456, confirmationState: "Accepted" };
const HINT = "check the order in KPN before retrying";

/** Resolve one synthetic successful write without network access. */
function stub() {
  const postRealtime = vi.fn().mockResolvedValue({
    httpStatus: 200,
    rootElement: "CustomPriceResponse_V1",
    document: { CustomPriceResponse_V1: { Status: { Code: "Success" } } },
  });
  return { postRealtime, client: { postRealtime } as unknown as GrexxClient };
}

describe("ambiguous invalid XML responses", () => {
  it("warns before retrying a confirmed write whose response cannot be parsed", async () => {
    const { client, postRealtime } = stub();
    postRealtime.mockRejectedValue(new GrexxError("Grexx realtime response was not valid XML", 0, "private response body", "invalid_xml"));
    const result = await handleGrexxToolCall(client, CUSTOM_PRICE.tool, { ...ARGS, [CONFIRM_ARG]: true });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain(HINT);
    expect(JSON.stringify(result)).not.toContain("private response body");
    expect(postRealtime).toHaveBeenCalledTimes(1);
    expect(postRealtime).toHaveBeenCalledWith(CUSTOM_PRICE.request, { OrderId: 123456, ConfirmationState: "Accepted" }, { idempotent: false });
  });

  it("does not add a write hint to the same SDK error for a read", () => {
    expect(describeGrexxError(new GrexxError("Invalid XML", 0, undefined, "invalid_xml"), "kpn_grexx_order_summary")).not.toContain(HINT);
  });

  it("does not treat an unrelated plain status-zero error as the SDK parse failure", () => {
    expect(describeGrexxError(new GrexxError("Local error", 0, undefined, "local_error"), CUSTOM_PRICE.tool)).not.toContain(HINT);
  });
});

describe("confirmation without a destructive annotation", () => {
  it("advertises the confirmation argument without marking the tool destructive", () => {
    const tool = realtimeTool(CONFIRM_ONLY);
    expect(tool.inputSchema.properties).toHaveProperty(CONFIRM_ARG);
    expect(tool.annotations?.destructiveHint).toBe(false);
  });

  it("blocks an unconfirmed non-eliciting caller", async () => {
    const { client, postRealtime } = stub();
    const result = await callRealtime(client, CONFIRM_ONLY, ARGS);
    expect(result).toHaveProperty("isError", true);
    expect(JSON.stringify(result)).toContain(CONFIRM_ARG);
    expect(postRealtime).not.toHaveBeenCalled();
  });

  it("prompts an eliciting caller even when the fallback flag is set", async () => {
    const { client, postRealtime } = stub();
    const result = await callRealtime(client, CONFIRM_ONLY, { ...ARGS, [CONFIRM_ARG]: true }, { clientCapabilities: { elicitation: {} } });
    expect(result).toHaveProperty("inputRequests");
    expect(JSON.stringify(result)).toContain("Accept KPN's custom price on order 123456?");
    expect(postRealtime).not.toHaveBeenCalled();
  });

  it("allows an explicitly confirmed non-eliciting caller", async () => {
    const { client, postRealtime } = stub();
    const result = await callRealtime(client, CONFIRM_ONLY, { ...ARGS, [CONFIRM_ARG]: true });
    expect(result).not.toHaveProperty("isError", true);
    expect(postRealtime).toHaveBeenCalledTimes(1);
    expect(postRealtime).toHaveBeenCalledWith(CUSTOM_PRICE.request, { OrderId: 123456, ConfirmationState: "Accepted" }, { idempotent: false });
  });

  it.each([false, true])("validates first even when fallback confirmation is %s", async (confirmed) => {
    const { client, postRealtime } = stub();
    await expect(callRealtime(client, CONFIRM_ONLY, { confirmationState: "Accepted", [CONFIRM_ARG]: confirmed })).rejects.toThrow("Order number (orderId) is required.");
    expect(postRealtime).not.toHaveBeenCalled();
  });
});
