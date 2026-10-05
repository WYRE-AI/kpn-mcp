/** Handler wiring against a stub KpnGrexxClient. No network. */
import { describe, expect, it, vi } from "vitest";
import { GrexxAuthenticationError, GrexxRateLimitError } from "@wyre-ai/node-kpn";
import { describeGrexxError, handleToolCall } from "../handlers/index.js";
import type { ToolResult } from "../handlers/results.js";
import { ok, stubClient } from "./stub-client.js";

function text(result: ToolResult): string {
  const content = result.content[0];
  return content.type === "text" ? content.text : "";
}

describe("kpn_grexx handlers", () => {
  it("test_connection returns the client probe when ok", async () => {
    const client = stubClient();
    const result = (await handleToolCall(client, "kpn_grexx_test_connection", {})) as ToolResult;
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result)).grexxCode).toBe(109);
    expect(client.testConnection).toHaveBeenCalledOnce();
  });

  it("test_connection is an error when the probe is not ok", async () => {
    const client = stubClient({
      testConnection: vi.fn(async () => ({
        ok: false,
        authenticated: false,
        grexxCode: 102,
        message: "bad credentials",
        authMode: "oauth" as const,
      })),
    });
    const result = (await handleToolCall(client, "kpn_grexx_test_connection", {})) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("102");
  });

  it("zipcode_check maps arguments onto zipCodeCheck and drops raw XML", async () => {
    const client = stubClient({
      zipCodeCheck: vi.fn(async () =>
        ok("ZipCodeCheckResponse_V5", { AvailableSupplier: [{ Name: "KPN" }] })
      ),
    });
    const result = (await handleToolCall(client, "kpn_grexx_zipcode_check", {
      portfolio: "All",
      zipCode: "1012JS",
      houseNumber: 1,
      isRoomNumberKnown: false,
    })) as ToolResult;
    expect(client.zipCodeCheck).toHaveBeenCalledWith({
      Portfolio: "All",
      ZipCode: "1012JS",
      HouseNr: 1,
      HouseNrExtension: undefined,
      ServiceId: undefined,
      RoomNumber: undefined,
      IsRoomNumberKnown: false,
      Suppliers: undefined,
    });
    const body = JSON.parse(text(result));
    expect(body.rootElement).toBe("ZipCodeCheckResponse_V5");
    expect(body.rawXml).toBeUndefined();
    expect(text(result)).not.toContain("<raw/>");
  });

  it("rejects a zipcode check without a portfolio", async () => {
    const client = stubClient();
    const result = (await handleToolCall(client, "kpn_grexx_zipcode_check", {
      zipCode: "1012JS",
      houseNumber: 1,
      isRoomNumberKnown: false,
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(client.zipCodeCheck).not.toHaveBeenCalled();
  });

  it("get_sim uses an integer OrderId and masks PUK and eSIM codes", async () => {
    const client = stubClient({
      getSim: vi.fn(async () =>
        ok("GetSimResponse_V1", {
          Sim: {
            ICCId: "8931000000000000001",
            Puc1: "73915064",
            ESim: { ActivationCode: "LPA:1$secret", ConfirmationCode: "9999" },
          },
        })
      ),
    });
    const result = (await handleToolCall(client, "kpn_grexx_get_sim", { orderId: 42 })) as ToolResult;
    expect(client.getSim).toHaveBeenCalledWith({ OrderId: 42 });
    const body = JSON.parse(text(result));
    expect(body.secretsMasked).toBe(true);
    expect(body.data.Sim.Puc1).toBe("••••");
    expect(body.data.Sim.ESim.ActivationCode).toBe("••••");
    expect(body.data.Sim.ESim.ConfirmationCode).toBe("••••");
    expect(body.data.Sim.ICCId).toBe("8931000000000000001");
    expect(text(result)).not.toContain("73915064");
  });

  it("radius_check masks Password", async () => {
    const client = stubClient({
      radiusCheck: vi.fn(async () =>
        ok("RadiusCheckResponse_V1", { ResponseItems: [{ User: "cpe", Password: "s3cret" }] })
      ),
    });
    const result = (await handleToolCall(client, "kpn_grexx_radius_check", {
      orderId: 7,
    })) as ToolResult;
    const body = JSON.parse(text(result));
    expect(body.data.ResponseItems[0].Password).toBe("••••");
    expect(body.data.ResponseItems[0].User).toBe("cpe");
  });

  it("maps Grexx auth and rate-limit errors", async () => {
    const auth = new GrexxAuthenticationError("Wrong username/password", {
      grexxCode: 102,
      httpStatus: 401,
    });
    const limited = new GrexxRateLimitError("Too Many Requests", {
      grexxCode: 108,
      httpStatus: 429,
      retryAfterSeconds: 3,
    });
    expect(describeGrexxError(auth)).toContain("code 102");
    expect(describeGrexxError(limited)).toContain("Retry after 3s");

    const client = stubClient({
      rasCheck: vi.fn(async () => {
        throw auth;
      }),
    });
    const result = (await handleToolCall(client, "kpn_grexx_ras_check", { orderId: 1 })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("code 102");
    expect(text(result)).not.toContain("responseXml");
  });

  it("available_portings requires customerId or hipGroupOrderId", async () => {
    const client = stubClient();
    const missing = (await handleToolCall(client, "kpn_grexx_available_portings", {})) as ToolResult;
    expect(missing.isError).toBe(true);
    expect(client.availablePortings).not.toHaveBeenCalled();

    await handleToolCall(client, "kpn_grexx_available_portings", { customerId: 9 });
    expect(client.availablePortings).toHaveBeenCalledWith({
      MobileSubscripionCustomerId: 9,
      HipGroupOrderId: undefined,
    });
  });

  it("mobile_orders passes 1–50 integer order ids", async () => {
    const client = stubClient();
    const bad = (await handleToolCall(client, "kpn_grexx_mobile_orders", {
      orderIds: [],
    })) as ToolResult;
    expect(bad.isError).toBe(true);

    await handleToolCall(client, "kpn_grexx_mobile_orders", { orderIds: [3, 4] });
    expect(client.getMobileSubscriptionOrders).toHaveBeenCalledWith({ OrderIds: [3, 4] });
  });

  it("unknown tool", async () => {
    const result = (await handleToolCall(stubClient(), "kpn_disturbances_check", {})) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Unknown tool");
  });
});
