/** Network-free KpnGrexxClient. Override only the methods a test calls. */
import { vi, type Mock } from "vitest";
import type { IrmaCallResult, KpnGrexxClient } from "@wyre-ai/node-kpn";

export function ok<T>(rootElement: string, data?: T): IrmaCallResult<T> {
  return { rootElement, grexxCode: 0, grexxCodeMessage: "Success", data, rawXml: "<raw/>" };
}

export function stubClient(
  overrides: Partial<Record<keyof KpnGrexxClient, Mock>> = {}
): KpnGrexxClient {
  return {
    authMode: "oauth",
    getAccessToken: vi.fn(async () => "token"),
    testConnection: vi.fn(async () => ({
      ok: true,
      authenticated: true,
      grexxCode: 109,
      message: "XML validation error",
      authMode: "oauth" as const,
    })),
    postRealtimeXml: vi.fn(),
    postXml: vi.fn(),
    zipCodeCheck: vi.fn(async () => ok("ZipCodeCheckResponse_V5", {})),
    prequalification: vi.fn(async () => ok("PrequalificationResponse_V1", {})),
    carrierInfo: vi.fn(async () => ok("CarrierInfoResponse_V1", {})),
    radiusCheck: vi.fn(async () => ok("RadiusCheckResponse_V1", {})),
    rasCheck: vi.fn(async () => ok("RasCheckResponse_V1", {})),
    startLineDiagnose: vi.fn(async () => ok("StartLineDiagnoseResponse_V1", {})),
    customerData: vi.fn(async () => ok("CustomerDataResponse_V1", {})),
    orderSummary: vi.fn(async () => ok("OrderSummaryRequest_V1", {})),
    orderData: vi.fn(async () => ok("OrderDataResponse_V1", {})),
    getSim: vi.fn(async () => ok("GetSimResponse_V1", {})),
    getMobileSettings: vi.fn(async () => ok("GetMobileSettingsResponse_V1", {})),
    getMobileSubscriptionUsage: vi.fn(async () => ok("GetMobileSubscriptionUsageResponse_V1", {})),
    getMobileSubscriptionOrders: vi.fn(async () => ok("GetMobileSubscriptionOrdersRequest_V1", {})),
    availablePortings: vi.fn(async () => ok("AvailablePortingsResponse_V1", {})),
    ...overrides,
  } as unknown as KpnGrexxClient;
}
