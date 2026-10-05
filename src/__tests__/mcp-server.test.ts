/** Credential resolution for the Grexx gateway and env modes. */
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

const BASE = "https://grexx.example.invalid/interfaces/pilot/";

describe("buildCredentials", () => {
  it("accepts username and password", () => {
    const { creds, error } = buildCredentials("user", "secret", { baseUrl: BASE });
    expect(error).toBeUndefined();
    expect(creds).toEqual({ username: "user", password: "secret", baseUrl: BASE });
  });

  it("names every missing required header", () => {
    const { error } = buildCredentials(undefined, undefined);
    for (const header of REQUIRED_GATEWAY_HEADERS) expect(error).toContain(header);
  });

  it("treats empty strings as absent", () => {
    expect(buildCredentials("", "secret").error).toContain("X-KPN-Grexx-Username");
    expect(buildCredentials("user", "  ").error).toContain("X-KPN-Grexx-Password");
  });
});

describe("resolveGatewayCredentials", () => {
  it("reads the Grexx headers and the env base URL", () => {
    const headers: Record<string, string> = {
      "x-kpn-grexx-username": "user",
      "x-kpn-grexx-password": "secret",
    };
    const { creds } = resolveGatewayCredentials((name) => headers[name], {
      KPN_GREXX_BASE_URL: BASE,
      KPN_GREXX_AUTH_MODE: "basic",
    });
    expect(creds).toMatchObject({
      username: "user",
      password: "secret",
      baseUrl: BASE,
      authMode: "basic",
    });
  });

  it("never takes the base URL from a header", () => {
    const { creds } = resolveGatewayCredentials(
      (name) => (name === "x-kpn-grexx-base-url" ? "https://attacker.example" : `v-${name}`),
      { KPN_GREXX_BASE_URL: BASE }
    );
    expect(creds?.baseUrl).toBe(BASE);
    expect(creds?.baseUrl).not.toContain("attacker");
  });

  it("does not fall through to env username or password", () => {
    const { creds, error } = resolveGatewayCredentials(() => undefined, {
      KPN_GREXX_USERNAME: "env-user",
      KPN_GREXX_PASSWORD: "env-pass",
      KPN_GREXX_BASE_URL: BASE,
    });
    expect(creds).toBeUndefined();
    expect(error).toContain("X-KPN-Grexx-Username");
  });
});

describe("resolveEnvCredentials", () => {
  it("reads KPN_GREXX_* including auth mode", () => {
    const { creds } = resolveEnvCredentials({
      KPN_GREXX_USERNAME: "user",
      KPN_GREXX_PASSWORD: "secret",
      KPN_GREXX_BASE_URL: BASE,
      KPN_GREXX_AUTH_MODE: "oauth",
      KPN_GREXX_TOKEN_URL: "https://grexx.example.invalid/oauth/access_token",
    });
    expect(creds).toMatchObject({
      username: "user",
      password: "secret",
      baseUrl: BASE,
      authMode: "oauth",
      tokenUrl: "https://grexx.example.invalid/oauth/access_token",
    });
  });

  it("rejects an unknown auth mode", () => {
    const { error } = resolveEnvCredentials({
      KPN_GREXX_USERNAME: "user",
      KPN_GREXX_PASSWORD: "secret",
      KPN_GREXX_BASE_URL: BASE,
      KPN_GREXX_AUTH_MODE: "bearer",
    });
    expect(error).toMatch(/oauth/);
  });
});

describe("stateless tool surface", () => {
  it("is the module-scope TOOLS array regardless of credentials", () => {
    expect(listToolsResult().tools).toBe(TOOLS);
    createMcpServer();
    createMcpServer({ username: "user", password: "secret", baseUrl: BASE });
    expect(listToolsResult().tools.map((tool) => tool.name)).toEqual(
      TOOLS.map((tool) => tool.name)
    );
  });
});

describe("makeMcpServerFactory", () => {
  it("never throws when gateway headers are missing", () => {
    const factory = makeMcpServerFactory({ gatewayMode: true });
    expect(() =>
      factory({ requestInfo: { headers: { get: () => null } } } as never)
    ).not.toThrow();
  });

  it("reads gateway headers", () => {
    const factory = makeMcpServerFactory({ gatewayMode: true });
    const headers = new Map<string, string>([
      ["x-kpn-grexx-username", "user"],
      ["x-kpn-grexx-password", "secret"],
    ]);
    expect(
      factory({
        requestInfo: { headers: { get: (name: string) => headers.get(name) ?? null } },
      } as never)
    ).toBeTruthy();
  });
});

describe("gateway header list", () => {
  it("is the two Grexx headers", () => {
    expect(GATEWAY_HEADERS).toEqual(["X-KPN-Grexx-Username", "X-KPN-Grexx-Password"]);
  });
});
