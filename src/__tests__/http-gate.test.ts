/**
 * HTTP-layer 401 gate. Mirrors src/index.ts using resolveGatewayCredentials.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import {
  GATEWAY_HEADERS,
  REQUIRED_GATEWAY_HEADERS,
  resolveGatewayCredentials,
} from "../mcp-server.js";

function createGateServer(isGatewayMode: boolean): http.Server {
  return http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      ["Content-Type", "Accept", "Authorization", "Mcp-Session-Id", ...GATEWAY_HEADERS].join(", ")
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (url.pathname === "/mcp") {
      if (isGatewayMode) {
        const { error } = resolveGatewayCredentials(
          (name) => req.headers[name] as string | undefined
        );
        if (error) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32001,
                message: `Unauthorized: ${error}`,
                data: { required: REQUIRED_GATEWAY_HEADERS },
              },
              id: null,
            })
          );
          return;
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "mcp-endpoint-reached" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", endpoints: ["/mcp", "/health"] }));
  });
}

function request(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: options.method || "GET", headers: options.headers },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("gateway-mode HTTP gate", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = createGateServer(true);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("/health is shallow and unauthenticated", async () => {
    const res = await request(port, "/health");
    expect(res.status).toBe(200);
  });

  it("missing credential headers → 401 naming the Grexx headers", async () => {
    const res = await request(port, "/mcp", { method: "POST" });
    expect(res.status).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe(-32001);
    expect(body.error.data.required).toEqual(["X-KPN-Grexx-Username", "X-KPN-Grexx-Password"]);
  });

  it("username without password is still 401", async () => {
    const res = await request(port, "/mcp", {
      method: "POST",
      headers: { "X-KPN-Grexx-Username": "user" },
    });
    expect(res.status).toBe(401);
  });

  it("both Grexx headers reach the MCP handler", async () => {
    const res = await request(port, "/mcp", {
      method: "POST",
      headers: { "X-KPN-Grexx-Username": "user", "X-KPN-Grexx-Password": "secret" },
    });
    expect(res.status).toBe(200);
  });

  it("CORS allow-headers include the Grexx credential headers", async () => {
    const res = await request(port, "/mcp", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    const allow = String(res.headers["access-control-allow-headers"]);
    for (const header of GATEWAY_HEADERS) expect(allow).toContain(header);
  });
});
