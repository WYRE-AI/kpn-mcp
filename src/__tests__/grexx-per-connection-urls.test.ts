/**
 * WYREAI-525: per-connection Grexx URLs (`X-Grexx-Api-Url` + `X-Grexx-Token-Url`).
 *
 * Resolver rules, the HTTP 400 gate, and that a gateway tools/call builds the
 * SDK client with the header URLs and `ssrfGuard: true` (env URLs: no guard).
 */
import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";

const built: Array<Record<string, unknown>> = [];

vi.mock("@wyre-ai/node-kpn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wyre-ai/node-kpn")>();
  class CapturingGrexxClient extends actual.GrexxClient {
    constructor(config: ConstructorParameters<typeof actual.GrexxClient>[0]) {
      super(config);
      built.push({ ...config });
    }
    override async postRealtime(): Promise<never> {
      throw new actual.GrexxConfigError("stubbed: no network in tests");
    }
  }
  return { ...actual, GrexxClient: CapturingGrexxClient };
});

const { GATEWAY_HEADERS, resolveGatewayCredentials, makeMcpServerFactory } = await import("../mcp-server.js");

const PROD_API = "https://service.grexx.today/interfaces/kpn/kpn_partners/abc123";
const PROD_TOKEN = "https://service.grexx.today/oauth/access_token";
const ENV_BASE = "https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/x";
const ENV_TOKEN = "https://service-accept.grexx.today/oauth/access_token";
const env = { KPN_GREXX_BASE_URL: ENV_BASE, KPN_GREXX_TOKEN_URL: ENV_TOKEN };
const CREDS = { "x-kpn-grexx-username": "tenant-user", "x-kpn-grexx-password": "tenant-secret" };

function resolveWith(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return resolveGatewayCredentials((name) => lower[name], { env, legacyEnabled: false });
}

describe("resolveGatewayCredentials: X-Grexx-Api-Url / X-Grexx-Token-Url", () => {
  it("uses both headers and marks the credentials per-connection", () => {
    const resolved = resolveWith({ ...CREDS, "X-Grexx-Api-Url": PROD_API, "X-Grexx-Token-Url": PROD_TOKEN });
    expect(resolved.rejectedUrl).toBeUndefined();
    expect(resolved.grexx).toEqual({
      username: "tenant-user",
      password: "tenant-secret",
      baseUrl: PROD_API,
      tokenUrl: PROD_TOKEN,
      perConnectionUrls: true,
    });
  });

  it("falls back to the env URLs when both are absent or blank", () => {
    const variants: Array<Record<string, string>> = [{}, { "X-Grexx-Api-Url": "", "X-Grexx-Token-Url": "   " }];
    for (const extra of variants) {
      const resolved = resolveWith({ ...CREDS, ...extra });
      expect(resolved.grexx).toEqual({
        username: "tenant-user",
        password: "tenant-secret",
        baseUrl: ENV_BASE,
        tokenUrl: ENV_TOKEN,
      });
    }
  });

  it.each([
    ["api only", { "X-Grexx-Api-Url": PROD_API }],
    ["token only", { "X-Grexx-Token-Url": PROD_TOKEN }],
    ["api with blank token", { "X-Grexx-Api-Url": PROD_API, "X-Grexx-Token-Url": " " }],
  ])("rejects a lone URL header (%s)", (_name, extra) => {
    const resolved = resolveWith({ ...CREDS, ...extra });
    expect(resolved.rejectedUrl).toBe(true);
    expect(resolved.rejectedUrlError).toMatch(/provided together/);
    expect(resolved.grexx).toBeUndefined();
  });

  it.each([
    ["non-Grexx host", "https://evil.example/oauth/access_token", /allowed Grexx host/],
    ["other grexx.today portal", "https://routit.grexx.today/oauth/access_token", /allowed Grexx host/],
    ["http", "http://service.grexx.today/oauth/access_token", /https/],
    ["userinfo", "https://a:b@service.grexx.today/oauth/access_token", /credentials/],
    ["port", "https://service.grexx.today:444/oauth/access_token", /port 443/],
    ["path", "https://service.grexx.today/oauth/other", /\/oauth\/access_token/],
  ])("rejects an invalid token URL (%s) without echoing it", (_name, tokenUrl, pattern) => {
    const resolved = resolveWith({ ...CREDS, "X-Grexx-Api-Url": PROD_API, "X-Grexx-Token-Url": tokenUrl });
    expect(resolved.rejectedUrl).toBe(true);
    expect(resolved.rejectedUrlError).toMatch(pattern);
    expect(resolved.rejectedUrlError).not.toContain(tokenUrl);
  });

  it("rejects an API URL outside /interfaces/kpn/", () => {
    const resolved = resolveWith({
      ...CREDS,
      "X-Grexx-Api-Url": "https://service.grexx.today/interfaces/routit/abc",
      "X-Grexx-Token-Url": PROD_TOKEN,
    });
    expect(resolved.rejectedUrlError).toMatch(/\/interfaces\/kpn\//);
  });

  it("still rejects the old URL header names", () => {
    const resolved = resolveWith({ ...CREDS, "X-KPN-Grexx-Base-Url": PROD_API });
    expect(resolved.rejectedUrl).toBe(true);
  });

  it("URL headers without credentials are still unauthorized (never paired with env secrets)", () => {
    const resolved = resolveWith({ "X-Grexx-Api-Url": PROD_API, "X-Grexx-Token-Url": PROD_TOKEN });
    expect(resolved.grexx).toBeUndefined();
    expect(resolved.grexxError).toMatch(/X-KPN-Grexx-Username/);
  });

  it("advertises both URL headers for CORS", () => {
    expect(GATEWAY_HEADERS).toEqual(expect.arrayContaining(["X-Grexx-Api-Url", "X-Grexx-Token-Url"]));
  });
});

describe("gateway tools/call builds the SDK client from the header URLs", () => {
  let mcpHandler: McpHttpHandler;
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    process.env.KPN_GREXX_BASE_URL = ENV_BASE;
    process.env.KPN_GREXX_TOKEN_URL = ENV_TOKEN;
    mcpHandler = createMcpHandler(makeMcpServerFactory({ gatewayMode: true }), { legacy: "stateless" });
    const handle = toNodeHandler(mcpHandler);
    server = http.createServer((req, res) => {
      void handle(req as unknown as Parameters<typeof handle>[0], res);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    delete process.env.KPN_GREXX_BASE_URL;
    delete process.env.KPN_GREXX_TOKEN_URL;
    await mcpHandler.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    built.length = 0;
  });

  async function callZip(headers: Record<string, string>): Promise<string> {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "kpn_grexx_zipcode_check",
          arguments: { portfolio: "All", zipCode: "1012JS", houseNumber: 1, isRoomNumberKnown: false },
        },
      }),
    });
    return res.text();
  }

  it("per-connection headers → header URLs with ssrfGuard on", async () => {
    await callZip({
      "X-KPN-Grexx-Username": "tenant-user",
      "X-KPN-Grexx-Password": "tenant-secret",
      "X-Grexx-Api-Url": PROD_API,
      "X-Grexx-Token-Url": PROD_TOKEN,
    });
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ baseUrl: PROD_API, tokenUrl: PROD_TOKEN, ssrfGuard: true });
  });

  it("no URL headers → env URLs, guard off (acceptatie default unchanged)", async () => {
    await callZip({ "X-KPN-Grexx-Username": "tenant-user", "X-KPN-Grexx-Password": "tenant-secret" });
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ baseUrl: ENV_BASE, tokenUrl: ENV_TOKEN });
    expect(built[0]?.ssrfGuard).toBeUndefined();
  });
});
