/** kpn_test_connection: mint the OAuth tokens and report what they say. */
import type { KpnClient } from "@wyre-technology/node-kpn";
import { errorResult, jsonResult, optionalBoolean, type ToolHandler, type ToolResult } from "./results.js";

const ENTITLEMENT_NOTE =
  "A minted token proves the client ID and secret only. Each KPN API product " +
  "(Disturbance Check, Internet Speed Check, SIM Swap, MSM) must also be added to the " +
  "project in developer.kpn.com, or its calls fail with 401/403.";

const MSM_NOTE =
  "The MSM token did not mint. Business-mobile tools need a customer GRIP-bound MSM app; " +
  "set X-KPN-MSM-Client-Id/Secret (or KPN_MSM_CLIENT_ID/SECRET) for this customer. " +
  "Network and SIM-swap tools are unaffected.";

async function testConnection(
  client: KpnClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const includeMsm = optionalBoolean(args, "includeMsm") ?? true;
  const { gateway, msm } = await client.testConnection({ includeMsm });
  const report = {
    gateway,
    ...(msm ? { msm } : {}),
    quota: client.lastQuota ?? null,
    note: msm && !msm.ok ? `${ENTITLEMENT_NOTE} ${MSM_NOTE}` : ENTITLEMENT_NOTE,
  };
  if (!gateway.ok) {
    return errorResult(
      `KPN credentials were rejected: the gateway token could not be minted.\n` +
        JSON.stringify(report, null, 2)
    );
  }
  return jsonResult(report);
}

export const CORE_HANDLERS: Record<string, ToolHandler> = {
  kpn_test_connection: testConnection,
};
