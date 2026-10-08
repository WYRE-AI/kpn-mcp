/** Credential resolution + stateless tool-list invariants. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GREXX_GATEWAY_HEADERS,
  REQUIRED_GATEWAY_HEADERS,
  SERVER_VERSION,
  buildLegacyCredentials,
  createMcpServer,
  listToolsResult,
  makeMcpServerFactory,
  packageVersion,
  resolveEnvCredentials,
  resolveGatewayCredentials,
} from "../mcp-server.js";
import { GREXX_TOOLS, TOOLS } from "../tools/index.js";

const BASE = "https://service-accept.grexx.today/interfaces/kpn/example/";
const TOKEN = "https://service-accept.grexx.today/oauth/access_token";

describe("buildLegacyCredentials", () => {
  it("accepts the required pair alone", () => {
    const { creds, error } = buildLegacyCredentials("id", "secret");
    expect(error).toBeUndefined();
    expect(creds).toEqual({ clientId: "id", clientSecret: "secret" });
  });

  it("accepts the required pair plus a complete MSM pair", () => {
    const { creds } = buildLegacyCredentials("id", "secret", "msm-id", "msm-secret");
    expect(creds).toEqual({
      clientId: "id",
      clientSecret: "secret",
      msmClientId: "msm-id",
      msmClientSecret: "msm-secret",
    });
  });

  it("names every missing required header when the pair is partial", () => {
    const { creds, error } = buildLegacyCredentials(undefined, "secret");
    expect(creds).toBeUndefined();
    expect(error).toContain("X-KPN-Client-Id");
  });

  it("treats a fully absent legacy pair as absent, not an error", () => {
    expect(buildLegacyCredentials(undefined, undefined).absent).toBe(true);
  });

  it("rejects a half MSM pair either way round", () => {
    expect(buildLegacyCredentials("id", "secret", "msm-id", undefined).error).toMatch(/MSM/);
    expect(buildLegacyCredentials("id", "secret", undefined, "msm-secret").error).toMatch(/MSM/);
  });

  it("treats empty strings as absent", () => {
    expect(buildLegacyCredentials("", "secret").error).toContain("X-KPN-Client-Id");
    expect(buildLegacyCredentials("id", "secret", "", "").creds).toEqual({
      clientId: "id",
      clientSecret: "secret",
    });
  });
});

describe("resolveGatewayCredentials", () => {
  const env = { KPN_GREXX_BASE_URL: BASE, KPN_GREXX_TOKEN_URL: TOKEN };

  it("reads X-KPN-Grexx-Username and password, and takes URLs from env", () => {
    const headers: Record<string, string> = {
      "x-kpn-grexx-username": "user",
      "x-kpn-grexx-password": "secret",
    };
    const seen: string[] = [];
    const resolved = resolveGatewayCredentials(
      (name) => {
        seen.push(name);
        return headers[name];
      },
      { env, legacyEnabled: false }
    );
    expect(resolved.grexx).toEqual({
      username: "user",
      password: "secret",
      baseUrl: BASE,
      tokenUrl: TOKEN,
    });
    expect(resolved.grexxError).toBeUndefined();
    expect(seen).toEqual([
      ...["x-kpn-grexx-base-url", "x-kpn-grexx-token-url", "x-kpn-grexx-baseurl", "x-kpn-grexx-tokenurl", "x-kpn-base-url", "x-kpn-token-url"],
      ...GREXX_GATEWAY_HEADERS.map((header) => header.toLowerCase()),
    ]);
  });

  it("does not fall through to env username or password", () => {
    const resolved = resolveGatewayCredentials(() => undefined, {
      env: {
        ...env,
        KPN_GREXX_USERNAME: "env-user",
        KPN_GREXX_PASSWORD: "env-pass",
      },
      legacyEnabled: false,
    });
    expect(resolved.grexx).toBeUndefined();
    expect(resolved.grexxError).toContain("X-KPN-Grexx-Username");
    expect(resolved.grexxError).toContain("X-KPN-Grexx-Password");
  });

  it("rejects a username without a password", () => {
    const resolved = resolveGatewayCredentials(
      (name) => (name === "x-kpn-grexx-username" ? "user" : undefined),
      { env, legacyEnabled: false }
    );
    expect(resolved.grexx).toBeUndefined();
    expect(resolved.grexxError).toContain("X-KPN-Grexx-Password");
  });

  it("rejects base URL and token URL headers and does not copy them", () => {
    for (const header of ["x-kpn-grexx-base-url", "x-kpn-grexx-token-url", "x-kpn-base-url"]) {
      const resolved = resolveGatewayCredentials(
        (name) => {
          if (name === "x-kpn-grexx-username") return "user";
          if (name === "x-kpn-grexx-password") return "secret";
          if (name === header) return "https://attacker.example/steal";
          return undefined;
        },
        { env, legacyEnabled: false }
      );
      expect(resolved.rejectedUrl, header).toBe(true);
      expect(resolved.grexx, header).toBeUndefined();
      expect(resolved.rejectedUrlError, header).toContain("KPN_GREXX_BASE_URL");
      expect(resolved.rejectedUrlError, header).toContain(header);
    }
  });

  it("ignores legacy headers when the legacy surface is off", () => {
    const resolved = resolveGatewayCredentials(
      (name) => {
        if (name === "x-kpn-grexx-username") return "user";
        if (name === "x-kpn-grexx-password") return "secret";
        if (name === "x-kpn-client-id") return "only-half";
        return undefined;
      },
      { env, legacyEnabled: false }
    );
    expect(resolved.legacy).toBeUndefined();
    expect(resolved.legacyError).toBeUndefined();
    expect(resolved.grexx?.username).toBe("user");
  });

  it("accepts a full legacy pair and rejects a half MSM pair when legacy is on", () => {
    const ok = resolveGatewayCredentials(
      (name) => {
        const headers: Record<string, string> = {
          "x-kpn-grexx-username": "user",
          "x-kpn-grexx-password": "secret",
          "x-kpn-client-id": "id",
          "x-kpn-client-secret": "secret",
          "x-kpn-msm-client-id": "msm",
          "x-kpn-msm-client-secret": "msm-secret",
        };
        return headers[name];
      },
      { env: { ...env, KPN_BASE_URL: "https://api-prd.kpn.com" }, legacyEnabled: true }
    );
    expect(ok.legacy).toEqual({
      clientId: "id",
      clientSecret: "secret",
      msmClientId: "msm",
      msmClientSecret: "msm-secret",
      baseUrl: "https://api-prd.kpn.com",
    });

    const half = resolveGatewayCredentials(
      (name) => {
        if (name === "x-kpn-grexx-username") return "user";
        if (name === "x-kpn-grexx-password") return "secret";
        if (name === "x-kpn-client-id") return "id";
        if (name === "x-kpn-client-secret") return "secret";
        if (name === "x-kpn-msm-client-id") return "msm";
        return undefined;
      },
      { env, legacyEnabled: true }
    );
    expect(half.legacyError).toMatch(/MSM/);
    expect(half.grexx?.username).toBe("user");
  });
});

describe("resolveEnvCredentials", () => {
  it("reads Grexx env vars and leaves the token URL unset when absent", () => {
    const resolved = resolveEnvCredentials(
      {
        KPN_GREXX_USERNAME: "user",
        KPN_GREXX_PASSWORD: "secret",
        KPN_GREXX_BASE_URL: BASE,
      },
      { legacyEnabled: false }
    );
    expect(resolved.grexx).toEqual({ username: "user", password: "secret", baseUrl: BASE });
    expect(resolved.grexx?.tokenUrl).toBeUndefined();
    expect(resolved.legacy).toBeUndefined();
  });

  it("names a missing Grexx password", () => {
    const resolved = resolveEnvCredentials(
      { KPN_GREXX_USERNAME: "user", KPN_GREXX_BASE_URL: BASE },
      { legacyEnabled: false }
    );
    expect(resolved.grexx).toBeUndefined();
    expect(resolved.grexxError).toContain("KPN_GREXX_PASSWORD");
  });

  it("reads legacy env vars only when the flag is on, including KPN_BASE_URL", () => {
    const resolved = resolveEnvCredentials(
      {
        KPN_GREXX_USERNAME: "user",
        KPN_GREXX_PASSWORD: "secret",
        KPN_GREXX_BASE_URL: BASE,
        KPN_CLIENT_ID: "id",
        KPN_CLIENT_SECRET: "secret",
        KPN_BASE_URL: "https://kpn.test.invalid",
      },
      { legacyEnabled: true }
    );
    expect(resolved.legacy).toEqual({
      clientId: "id",
      clientSecret: "secret",
      baseUrl: "https://kpn.test.invalid",
    });
  });
});

describe("stateless tool surface", () => {
  it("returns the module-scope TOOLS array by reference every time", () => {
    expect(listToolsResult().tools).toBe(TOOLS);
    expect(listToolsResult().tools).toBe(GREXX_TOOLS);
    expect(listToolsResult().tools).toBe(listToolsResult().tools);
  });

  it("is identical regardless of credentials", () => {
    createMcpServer();
    const withoutCreds = listToolsResult().tools.map((tool) => tool.name);
    createMcpServer({
      grexx: { username: "user", password: "secret", baseUrl: BASE },
    });
    const withCreds = listToolsResult().tools.map((tool) => tool.name);
    expect(withoutCreds).toEqual(withCreds);
    expect(withoutCreds).toEqual(["kpn_grexx_test_connection", "kpn_grexx_zipcode_check"]);
  });
});

describe("makeMcpServerFactory", () => {
  it("builds a server from Grexx gateway headers per request", () => {
    const factory = makeMcpServerFactory({ gatewayMode: true });
    const headers = new Map<string, string>([
      ["x-kpn-grexx-username", "user"],
      ["x-kpn-grexx-password", "secret"],
    ]);
    const server = factory({
      requestInfo: { headers: { get: (name: string) => headers.get(name) ?? null } },
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

describe("required gateway headers", () => {
  it("names the Grexx username and password", () => {
    expect([...REQUIRED_GATEWAY_HEADERS]).toEqual([
      "X-KPN-Grexx-Username",
      "X-KPN-Grexx-Password",
    ]);
  });
});

describe("packageVersion", () => {
  it("reports the package.json version rather than the MCP protocol identity", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    expect(packageVersion()).toBe(pkg.version);
    expect(packageVersion()).not.toBe(SERVER_VERSION);
  });
});
