/** Credential resolution + stateless tool-list invariants. */
import { describe, expect, it } from "vitest";
import {
  buildCredentials,
  createMcpServer,
  GATEWAY_HEADERS,
  listToolsResult,
  makeMcpServerFactory,
  REQUIRED_GATEWAY_HEADERS,
  resolveEnvCredentials,
  resolveGatewayCredentials,
} from "../mcp-server.js";
import { TOOLS } from "../tools/index.js";

describe("buildCredentials", () => {
  it("accepts the required pair alone", () => {
    const { creds, error } = buildCredentials("id", "secret");
    expect(error).toBeUndefined();
    expect(creds).toEqual({ clientId: "id", clientSecret: "secret" });
  });

  it("accepts the required pair plus a complete MSM pair", () => {
    const { creds } = buildCredentials("id", "secret", "msm-id", "msm-secret");
    expect(creds).toEqual({
      clientId: "id",
      clientSecret: "secret",
      msmClientId: "msm-id",
      msmClientSecret: "msm-secret",
    });
  });

  it("names every missing required header", () => {
    const { creds, error } = buildCredentials(undefined, undefined);
    expect(creds).toBeUndefined();
    for (const header of REQUIRED_GATEWAY_HEADERS) expect(error).toContain(header);
  });

  it("rejects a half MSM pair either way round", () => {
    expect(buildCredentials("id", "secret", "msm-id", undefined).error).toMatch(/MSM/);
    expect(buildCredentials("id", "secret", undefined, "msm-secret").error).toMatch(/MSM/);
  });

  it("treats empty strings as absent", () => {
    expect(buildCredentials("", "secret").error).toContain("X-KPN-Client-Id");
    expect(buildCredentials("id", "secret", "", "").creds).toEqual({
      clientId: "id",
      clientSecret: "secret",
    });
  });
});

describe("resolveGatewayCredentials", () => {
  it("reads the exact lowercased x-kpn-* headers", () => {
    const headers: Record<string, string> = {
      "x-kpn-client-id": "id",
      "x-kpn-client-secret": "secret",
      "x-kpn-msm-client-id": "msm-id",
      "x-kpn-msm-client-secret": "msm-secret",
    };
    const seen: string[] = [];
    const { creds } = resolveGatewayCredentials((name) => {
      seen.push(name);
      return headers[name];
    });
    expect(creds).toEqual({
      clientId: "id",
      clientSecret: "secret",
      msmClientId: "msm-id",
      msmClientSecret: "msm-secret",
    });
    expect(seen).toEqual(GATEWAY_HEADERS.map((h) => h.toLowerCase()));
  });

  it("errors when a required header is absent", () => {
    const { error } = resolveGatewayCredentials((name) =>
      name === "x-kpn-client-id" ? "id" : undefined
    );
    expect(error).toBeTruthy();
  });

  it("never carries a base URL (env mode only — SSRF guard)", () => {
    const { creds } = resolveGatewayCredentials((name) =>
      name === "x-kpn-base-url" ? "https://attacker.example" : `v-${name}`
    );
    expect(creds?.baseUrl).toBeUndefined();
  });
});

describe("resolveEnvCredentials", () => {
  it("reads KPN_* env vars, including the base URL", () => {
    const { creds } = resolveEnvCredentials({
      KPN_CLIENT_ID: "id",
      KPN_CLIENT_SECRET: "secret",
      KPN_MSM_CLIENT_ID: "msm-id",
      KPN_MSM_CLIENT_SECRET: "msm-secret",
      KPN_BASE_URL: "https://kpn.test.invalid",
    });
    expect(creds).toEqual({
      clientId: "id",
      clientSecret: "secret",
      msmClientId: "msm-id",
      msmClientSecret: "msm-secret",
      baseUrl: "https://kpn.test.invalid",
    });
  });

  it("leaves the base URL to the SDK default when unset", () => {
    const { creds } = resolveEnvCredentials({ KPN_CLIENT_ID: "id", KPN_CLIENT_SECRET: "s" });
    expect(creds).toEqual({ clientId: "id", clientSecret: "s" });
  });
});

describe("stateless tool surface", () => {
  it("returns the module-scope TOOLS array by reference every time", () => {
    expect(listToolsResult().tools).toBe(TOOLS);
    expect(listToolsResult().tools).toBe(listToolsResult().tools);
  });

  it("is identical (same order) regardless of credentials", () => {
    // The list never varies by caller — createMcpServer with and without
    // credentials serves the same reference.
    createMcpServer();
    const withoutCreds = listToolsResult().tools.map((t) => t.name);
    createMcpServer({ clientId: "id", clientSecret: "secret" });
    const withCreds = listToolsResult().tools.map((t) => t.name);
    expect(withoutCreds).toEqual(withCreds);
  });
});

describe("makeMcpServerFactory", () => {
  it("builds a server from gateway headers per request", () => {
    const factory = makeMcpServerFactory({ gatewayMode: true });
    const headers = new Map<string, string>([
      ["x-kpn-client-id", "id"],
      ["x-kpn-client-secret", "secret"],
    ]);
    const server = factory({
      requestInfo: { headers: { get: (n: string) => headers.get(n) ?? null } },
    } as never);
    expect(server).toBeTruthy();
  });

  it("never throws even with no credentials (401 gate lives in the HTTP layer)", () => {
    const factory = makeMcpServerFactory({ gatewayMode: true });
    expect(() =>
      factory({
        requestInfo: { headers: { get: () => null } },
      } as never)
    ).not.toThrow();
  });
});
