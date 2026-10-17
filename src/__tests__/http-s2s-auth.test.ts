/**
 * HTTP transport fail-closed auth.
 *
 * Startup requires a real CONDUIT_S2S_SECRET. Known placeholders are rejected
 * even when MCP_ALLOW_INSECURE_DEV=1. That flag is the only bypass for an
 * empty secret, and it listens on 127.0.0.1 only. /mcp rejects a missing or
 * invalid X-Gateway-S2S header. AUTH_MODE=gateway rejects requests that omit
 * Grexx credential headers and must not fall back to KPN_GREXX_* in process.env.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHttpTransport, type HttpTransport } from "../index.js";

const S2S_SECRET = "s2s-do-not-log-7f3a9c";
const ENV_USERNAME = "env-grexx-user-must-not-leak";
const ENV_PASSWORD = "env-grexx-password-must-not-leak";

const PLACEHOLDERS = [
  "replace-with-a-real-secret",
  "your-s2s-secret",
  "your-secret",
  "changeme",
  "change-me",
  "placeholder",
  "secret",
  "example",
  "replace-me",
  "s2s-secret",
] as const;

const ENV_KEYS = [
  "CONDUIT_S2S_SECRET",
  "MCP_ALLOW_INSECURE_DEV",
  "MCP_HTTP_PORT",
  "MCP_HTTP_HOST",
  "AUTH_MODE",
  "KPN_GREXX_USERNAME",
  "KPN_GREXX_PASSWORD",
  "KPN_GREXX_BASE_URL",
  "KPN_GREXX_TOKEN_URL",
  "LOG_LEVEL",
  "MCP_TRANSPORT",
] as const;

const savedEnv = new Map<string, string | undefined>();
const open: HttpTransport[] = [];

function mintS2sHeader(secret: string, unixSeconds = Math.floor(Date.now() / 1000)): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac("sha256", secret).update(message).digest("hex");
  return `${message},v1=${hex}`;
}

function captureStderr(): { text: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
  return {
    text: () => chunks.join(""),
    restore: () => spy.mockRestore(),
  };
}

function exitOnCall(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, "exit").mockImplementation((code?: string | number | null): never => {
    throw new Error(`process.exit:${code ?? ""}`);
  });
}

/** Words that also appear in the static refusal text, so they cannot prove a leak. */
const TEMPLATE_WORDS = new Set(["secret", "placeholder"]);

function assertNoSecrets(text: string, values: string[] = []): void {
  expect(text).not.toContain(S2S_SECRET);
  expect(text).not.toContain(ENV_USERNAME);
  expect(text).not.toContain(ENV_PASSWORD);
  for (const value of values) {
    const needle = value.trim().toLowerCase();
    if (TEMPLATE_WORDS.has(needle)) continue;
    expect(text.toLowerCase()).not.toContain(needle);
  }
}

interface HttpResult {
  status: number;
  body: string;
}

function sendHttp(options: {
  port: number;
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: options.port,
        method: options.method ?? "GET",
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      }
    );
    req.setTimeout(8000, () => {
      req.destroy(new Error(`timeout ${options.method ?? "GET"} ${options.path}`));
    });
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function listenPort(server: HttpTransport["server"]): number {
  const address = server.address() as AddressInfo | null;
  if (!address || typeof address === "string") throw new Error("server is not listening");
  return address.port;
}

function bindAddress(server: HttpTransport["server"]): string {
  const address = server.address() as AddressInfo | null;
  if (!address || typeof address === "string") throw new Error("server is not listening");
  return address.address;
}

const toolsList = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

function mcpHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extra,
  };
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.MCP_HTTP_PORT = "0";
  process.env.LOG_LEVEL = "error";
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((transport) => transport.close()));
  for (const key of ENV_KEYS) {
    const previous = savedEnv.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  vi.restoreAllMocks();
});

describe("HTTP S2S startup", () => {
  it("refuses to start when CONDUIT_S2S_SECRET is unset", async () => {
    process.env.KPN_GREXX_PASSWORD = ENV_PASSWORD;
    const logs = captureStderr();
    exitOnCall();
    await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
    const logged = logs.text();
    expect(logged).toContain("CONDUIT_S2S_SECRET is empty");
    expect(logged).toContain("Refusing to start");
    assertNoSecrets(logged);
    logs.restore();
  });

  it("refuses to start when CONDUIT_S2S_SECRET is empty or whitespace", async () => {
    process.env.CONDUIT_S2S_SECRET = "   ";
    process.env.MCP_ALLOW_INSECURE_DEV = "true";
    const logs = captureStderr();
    exitOnCall();
    await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
    expect(logs.text()).toContain("Refusing to start");
    assertNoSecrets(logs.text());
    logs.restore();
  });

  it("refuses known placeholder secrets, including with MCP_ALLOW_INSECURE_DEV=1", async () => {
    for (const placeholder of PLACEHOLDERS) {
      process.env.CONDUIT_S2S_SECRET = placeholder.toUpperCase();
      process.env.MCP_ALLOW_INSECURE_DEV = "1";
      process.env.MCP_HTTP_HOST = "0.0.0.0";
      const logs = captureStderr();
      exitOnCall();
      await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
      const logged = logs.text();
      expect(logged).toContain("known placeholder");
      expect(logged).not.toContain("WITHOUT service-to-service authentication");
      assertNoSecrets(logged, [placeholder]);
      logs.restore();
      vi.restoreAllMocks();
    }
  });

  it("refuses a trimmed placeholder", async () => {
    process.env.CONDUIT_S2S_SECRET = "  secret  ";
    const logs = captureStderr();
    exitOnCall();
    await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
    expect(logs.text()).toContain("known placeholder");
    assertNoSecrets(logs.text());
    logs.restore();
  });

  it("starts with a loud warning when MCP_ALLOW_INSECURE_DEV=1", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    const logs = captureStderr();
    const exitSpy = exitOnCall();

    const transport = await startHttpTransport();
    open.push(transport);

    expect(exitSpy).not.toHaveBeenCalled();
    const logged = logs.text();
    expect(logged).toContain("SECURITY WARNING:");
    expect(logged).toContain("MCP_ALLOW_INSECURE_DEV=1");
    expect(logged).toContain("WITHOUT service-to-service authentication");
    expect(logged).toContain("127.0.0.1");
    assertNoSecrets(logged);
    expect(bindAddress(transport.server)).toBe("127.0.0.1");
    logs.restore();
  });

  it("binds 127.0.0.1 when the dev bypass is set and MCP_HTTP_HOST is non-loopback", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    process.env.MCP_HTTP_HOST = "0.0.0.0";
    const logs = captureStderr();
    const exitSpy = exitOnCall();

    const transport = await startHttpTransport();
    open.push(transport);

    expect(exitSpy).not.toHaveBeenCalled();
    const logged = logs.text();
    expect(logged).toContain("MCP_HTTP_HOST=0.0.0.0 is not a loopback address");
    expect(logged).toContain("Binding 127.0.0.1 only");
    assertNoSecrets(logged);
    expect(bindAddress(transport.server)).toBe("127.0.0.1");
    logs.restore();
  });

  it("honors a non-loopback MCP_HTTP_HOST when CONDUIT_S2S_SECRET is set", async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = "0.0.0.0";
    const logs = captureStderr();

    const transport = await startHttpTransport();
    open.push(transport);

    expect(logs.text()).not.toContain("not a loopback address");
    assertNoSecrets(logs.text());
    expect(bindAddress(transport.server)).toBe("0.0.0.0");
    logs.restore();
  });

  it("keeps the historical 0.0.0.0 bind when a secret is set and MCP_HTTP_HOST is unset", async () => {
    process.env.CONDUIT_S2S_SECRET = `  ${S2S_SECRET}  `;
    const logs = captureStderr();

    const transport = await startHttpTransport();
    open.push(transport);

    expect(bindAddress(transport.server)).toBe("0.0.0.0");
    assertNoSecrets(logs.text());
    logs.restore();
  });
});

describe("HTTP S2S requests", () => {
  it("returns 401 when the S2S header is missing or invalid", async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = "127.0.0.1";
    process.env.AUTH_MODE = "gateway";
    process.env.KPN_GREXX_USERNAME = ENV_USERNAME;
    process.env.KPN_GREXX_PASSWORD = ENV_PASSWORD;
    const logs = captureStderr();

    const transport = await startHttpTransport();
    open.push(transport);
    assertNoSecrets(logs.text());
    const port = listenPort(transport.server);

    const missing = await sendHttp({
      port,
      method: "POST",
      path: "/mcp",
      headers: mcpHeaders({
        "x-kpn-grexx-username": "header-user",
        "x-kpn-grexx-password": "header-password",
      }),
      body: toolsList,
    });
    expect(missing.status).toBe(401);
    expect(missing.body).toContain("X-Gateway-S2S");
    assertNoSecrets(missing.body);

    const invalid = await sendHttp({
      port,
      method: "POST",
      path: "/mcp",
      headers: mcpHeaders({
        "x-gateway-s2s": mintS2sHeader("wrong-secret"),
        "x-kpn-grexx-username": "header-user",
        "x-kpn-grexx-password": "header-password",
      }),
      body: toolsList,
    });
    expect(invalid.status).toBe(401);
    expect(invalid.body).toContain("X-Gateway-S2S");
    assertNoSecrets(invalid.body);
    logs.restore();
  });

  it("returns 401 in gateway mode without credential headers and does not use env credentials", async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = "127.0.0.1";
    process.env.AUTH_MODE = "gateway";
    process.env.KPN_GREXX_USERNAME = ENV_USERNAME;
    process.env.KPN_GREXX_PASSWORD = ENV_PASSWORD;
    process.env.KPN_GREXX_BASE_URL = "https://grexx.test.invalid/interfaces/kpn/example/";
    const logs = captureStderr();

    const transport = await startHttpTransport();
    open.push(transport);
    const port = listenPort(transport.server);
    const s2s = mintS2sHeader(S2S_SECRET);

    const missing = await sendHttp({
      port,
      method: "POST",
      path: "/mcp",
      headers: mcpHeaders({ "x-gateway-s2s": s2s }),
      body: toolsList,
    });
    expect(missing.status).toBe(401);
    const body = JSON.parse(missing.body) as {
      jsonrpc?: string;
      error?: { code?: number; data?: { required?: string[] } };
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error?.code).toBe(-32001);
    expect(body.error?.data?.required).toEqual(["X-KPN-Grexx-Username", "X-KPN-Grexx-Password"]);
    assertNoSecrets(missing.body);

    const partial = await sendHttp({
      port,
      method: "POST",
      path: "/mcp",
      headers: mcpHeaders({
        "x-gateway-s2s": s2s,
        "x-kpn-grexx-username": "header-user",
      }),
      body: toolsList,
    });
    expect(partial.status).toBe(401);
    assertNoSecrets(partial.body);
    assertNoSecrets(logs.text());
    logs.restore();
  });

  it("accepts a valid S2S header plus credential headers", async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = "127.0.0.1";
    process.env.AUTH_MODE = "gateway";
    process.env.KPN_GREXX_USERNAME = ENV_USERNAME;
    process.env.KPN_GREXX_PASSWORD = ENV_PASSWORD;
    process.env.KPN_GREXX_BASE_URL = "https://grexx.test.invalid/interfaces/kpn/example/";
    const logs = captureStderr();

    const transport = await startHttpTransport();
    open.push(transport);
    const port = listenPort(transport.server);

    const response = await sendHttp({
      port,
      method: "POST",
      path: "/mcp",
      headers: mcpHeaders({
        "x-gateway-s2s": mintS2sHeader(S2S_SECRET),
        "x-kpn-grexx-username": "header-user",
        "x-kpn-grexx-password": "header-password",
      }),
      body: toolsList,
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain("kpn_grexx_test_connection");
    assertNoSecrets(response.body);
    expect(response.body).not.toContain("header-password");
    assertNoSecrets(logs.text());
    logs.restore();
  });

  it("serves /health and /healthz without authentication and without reading credentials", async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = "127.0.0.1";
    process.env.AUTH_MODE = "gateway";
    process.env.KPN_GREXX_USERNAME = ENV_USERNAME;
    process.env.KPN_GREXX_PASSWORD = ENV_PASSWORD;

    const transport = await startHttpTransport();
    open.push(transport);
    const port = listenPort(transport.server);

    for (const path of ["/health", "/healthz"]) {
      const response = await sendHttp({ port, path });
      expect(response.status).toBe(200);
      const body = JSON.parse(response.body) as { status?: string; authMode?: string };
      expect(body.status).toBe("ok");
      expect(body.authMode).toBe("gateway");
      assertNoSecrets(response.body);
    }
  });

  it("does not enforce X-Gateway-S2S on the insecure-dev bypass", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    process.env.MCP_HTTP_HOST = "0.0.0.0";
    process.env.AUTH_MODE = "env";
    process.env.KPN_GREXX_USERNAME = ENV_USERNAME;
    process.env.KPN_GREXX_PASSWORD = ENV_PASSWORD;
    process.env.KPN_GREXX_BASE_URL = "https://grexx.test.invalid/interfaces/kpn/example/";
    const logs = captureStderr();

    const transport = await startHttpTransport();
    open.push(transport);
    expect(bindAddress(transport.server)).toBe("127.0.0.1");
    const port = listenPort(transport.server);

    const response = await sendHttp({
      port,
      method: "POST",
      path: "/mcp",
      headers: mcpHeaders(),
      body: toolsList,
    });
    expect(response.status).toBe(200);
    expect(response.body).not.toContain("X-Gateway-S2S");
    assertNoSecrets(response.body);
    assertNoSecrets(logs.text());
    logs.restore();
  });
});

describe("fail-closed config files", () => {
  it("compose requires CONDUIT_S2S_SECRET and does not inject static Grexx credentials", () => {
    const compose = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");
    expect(compose).toContain("CONDUIT_S2S_SECRET=${CONDUIT_S2S_SECRET:?set CONDUIT_S2S_SECRET}");
    expect(compose).toContain("127.0.0.1:8080:8080");
    expect(compose).toContain("AUTH_MODE=gateway");
    expect(compose).not.toMatch(/^\s*(-\s*)?env_file\s*:/m);
    const assignments = compose
      .split("\n")
      .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
      .join("\n");
    for (const name of [
      "KPN_GREXX_USERNAME",
      "KPN_GREXX_PASSWORD",
      "KPN_CLIENT_ID",
      "KPN_CLIENT_SECRET",
      "KPN_MSM_CLIENT_ID",
      "KPN_MSM_CLIENT_SECRET",
    ]) {
      expect(assignments).not.toContain(name);
    }
  });

  it("env.example leaves CONDUIT_S2S_SECRET empty", () => {
    const example = readFileSync(new URL("../../env.example", import.meta.url), "utf8");
    expect(example).toMatch(/^CONDUIT_S2S_SECRET=\s*$/m);
  });
});
