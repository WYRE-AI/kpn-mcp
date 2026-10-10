import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyS2sHeader } from "../s2s-verify.js";

function mintHeader(secret: string, unixSeconds: number): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac("sha256", secret).update(message).digest("hex");
  return `${message},v1=${hex}`;
}

describe("verifyS2sHeader", () => {
  const configuredSecret = "test-vendor-secret-do-not-use-in-prod";
  const otherSecret = "test-other-secret-do-not-use-in-prod";

  it("accepts a header signed with the configured secret", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyS2sHeader(mintHeader(configuredSecret, now), configuredSecret)).toBe(true);
  });
  it("rejects a header signed with a different secret", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyS2sHeader(mintHeader(otherSecret, now), configuredSecret)).toBe(false);
  });
  it("rejects a stale timestamp outside the skew window", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyS2sHeader(mintHeader(configuredSecret, now - 301), configuredSecret)).toBe(false);
  });
  it("rejects a future timestamp outside the skew window", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyS2sHeader(mintHeader(configuredSecret, now + 301), configuredSecret)).toBe(false);
  });
  it("accepts a timestamp at the edge of the skew window", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyS2sHeader(mintHeader(configuredSecret, now - 300), configuredSecret)).toBe(true);
  });
  it("rejects a malformed header value", () => {
    expect(verifyS2sHeader("not-a-valid-header", configuredSecret)).toBe(false);
  });
  it("rejects a missing header", () => {
    expect(verifyS2sHeader(undefined, configuredSecret)).toBe(false);
  });
  it("rejects when the secret is empty", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyS2sHeader(mintHeader(configuredSecret, now), "")).toBe(false);
  });
  it("rejects a tampered signature", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = mintHeader(configuredSecret, now);
    const tampered = header.slice(0, -1) + (header.endsWith("0") ? "1" : "0");
    expect(verifyS2sHeader(tampered, configuredSecret)).toBe(false);
  });
});
