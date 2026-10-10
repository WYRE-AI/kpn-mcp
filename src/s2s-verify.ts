/**
 * Checks the gateway service-to-service header (`X-Gateway-S2S`).
 *
 * When `CONDUIT_S2S_SECRET` is set, the HTTP server requires a valid header
 * on every request except `/health`. Conduit injects that header at call time.
 * The value is `t=<unix seconds>,v1=<hex hmac-sha256 of "t=<unix seconds>">`,
 * compared in constant time. A timestamp more than `maxSkewSeconds` from now
 * (default 300) is rejected. The secret is an opaque string.
 *
 * An empty secret always fails this check. The HTTP server treats an unset
 * `CONDUIT_S2S_SECRET` as the check being off and does not call this function.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Request header carrying the S2S proof. Node lowercases incoming header names. */
export const S2S_HEADER = "x-gateway-s2s";

const HEADER_VALUE_RE = /^t=(\d{1,15}),v1=([0-9a-f]{64})$/;

export function verifyS2sHeader(
  headerValue: string | undefined,
  secret: string,
  maxSkewSeconds = 300
): boolean {
  if (!secret || !headerValue) return false;
  const match = HEADER_VALUE_RE.exec(headerValue);
  if (!match) return false;
  const t = Number(match[1]);
  if (!Number.isSafeInteger(t)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > maxSkewSeconds) return false;
  const expected = createHmac("sha256", secret).update(`t=${t}`).digest();
  const provided = Buffer.from(match[2], "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
