/**
 * End-to-end elicitation over the REAL serving stack: the same
 * createMcpHandler({ legacy: 'stateless' }) + toNodeHandler wiring as
 * src/index.ts, with only the vendor KpnClient stubbed.
 *
 * Proves the MRTR seam on both protocol eras, using kpn_mobile_sim_block:
 * - a 2026-07-28 client with the elicitation capability gets the block
 *   confirmation as an embedded `elicitation/create` request (auto-fulfilled
 *   by the v2 client) — decline cancels the order, accept lets it fire;
 * - a stateless 2025-era caller (no capability view) — how the WYRE Conduit
 *   gateway connects — cannot be prompted, so the block is BLOCKED unless the
 *   request carries an explicit `confirm_destructive_action`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";

const CONTRACT = {
  id: 123456,
  mobileNumber: "+31612345678",
  firstName: "Jan",
  lastName: "Jansen",
  state: "ACTIVE",
};

const { contractsApi } = vi.hoisted(() => ({
  contractsApi: {
    getOperations: vi.fn(),
    get: vi.fn(),
    blockSim: vi.fn(),
  },
}));

vi.mock("@wyre-ai/node-kpn/legacy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wyre-ai/node-kpn/legacy")>();
  return {
    ...actual,
    KpnClient: class {
      mobile = { contracts: contractsApi };
    },
  };
});

// Captured when mcp-server loads. This file is the only suite that needs the
// developer.kpn.com tools; the default surface is Grexx-only.
process.env.KPN_LEGACY_DEVELOPER_API = "1";
const { makeMcpServerFactory } = await import("../mcp-server.js");
delete process.env.KPN_LEGACY_DEVELOPER_API;

const ENV_KEYS = ["KPN_CLIENT_ID", "KPN_CLIENT_SECRET"] as const;

describe("elicitation over the live dual-era serving stack", () => {
  let mcpHandler: McpHttpHandler;
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    for (const key of ENV_KEYS) process.env[key] = "test-value";
    mcpHandler = createMcpHandler(makeMcpServerFactory({ gatewayMode: false }), {
      legacy: "stateless",
    });
    const handleMcp = toNodeHandler(mcpHandler);
    server = http.createServer((req, res) => {
      void handleMcp(req as unknown as Parameters<typeof handleMcp>[0], res);
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
    for (const key of ENV_KEYS) delete process.env[key];
    await mcpHandler.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    contractsApi.getOperations.mockResolvedValue({
      contractId: CONTRACT.id,
      blockSim: { enabled: true, visible: true },
    });
    contractsApi.get.mockResolvedValue(CONTRACT);
    contractsApi.blockSim.mockResolvedValue({ id: 900001, status: "InProgress" });
  });

  async function modernBlock(confirm: boolean): Promise<{ prompts: string[]; text: string }> {
    const { Client, StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/client"
    );
    const prompts: string[] = [];
    const client = new Client(
      { name: "elicit-e2e", version: "0.0.0" },
      {
        capabilities: { elicitation: {} },
        // Negotiate the modern era — the default is a plain 2025 connect.
        versionNegotiation: { mode: "auto" },
      }
    );
    client.setRequestHandler("elicitation/create", async (request) => {
      prompts.push(request.params.message);
      return { action: "accept" as const, content: { confirm } };
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    try {
      const result = await client.callTool({
        name: "kpn_mobile_sim_block",
        arguments: { contractId: CONTRACT.id },
      });
      const content = result.content as Array<{ type: string; text?: string }>;
      return { prompts, text: content[0]?.text ?? "" };
    } finally {
      await client.close();
    }
  }

  it("2026-07-28 era: declined confirmation cancels the block", async () => {
    const { prompts, text } = await modernBlock(false);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("+31612345678");
    expect(text).toContain("Cancelled; nothing was changed.");
    expect(contractsApi.blockSim).not.toHaveBeenCalled();
  });

  it("2026-07-28 era: accepted confirmation lets the block fire once", async () => {
    const { prompts, text } = await modernBlock(true);
    expect(prompts).toHaveLength(1);
    expect(contractsApi.blockSim).toHaveBeenCalledTimes(1);
    expect(contractsApi.blockSim.mock.calls[0][0]).toMatchObject({ contractId: CONTRACT.id });
    expect(text).toContain("kpn_mobile_orders_get");
  });

  /** One stateless 2025-era tools/call — no initialize, so no capability view. */
  async function statelessBlock(
    args: Record<string, unknown>
  ): Promise<{ isError?: boolean; text: string }> {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "kpn_mobile_sim_block", arguments: args },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const dataLines = text.split("\n").filter((line) => line.startsWith("data:"));
    const message = JSON.parse(
      (dataLines.length > 0 ? dataLines[dataLines.length - 1].slice(5) : text).trim()
    );
    return {
      isError: message.result?.isError,
      text: message.result?.content?.[0]?.text ?? "",
    };
  }

  it("stateless 2025-era caller: no capability view → the block is blocked, not assumed", async () => {
    const { isError, text } = await statelessBlock({ contractId: CONTRACT.id });
    expect(isError).toBe(true);
    expect(text).toContain("confirm_destructive_action");
    expect(contractsApi.blockSim).not.toHaveBeenCalled();
  });

  it("stateless 2025-era caller: explicit confirmation lets the block fire", async () => {
    const { isError } = await statelessBlock({
      contractId: CONTRACT.id,
      confirm_destructive_action: true,
    });
    expect(isError).toBeFalsy();
    expect(contractsApi.blockSim).toHaveBeenCalledTimes(1);
  });
});
