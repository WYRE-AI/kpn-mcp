/**
 * A network-free KpnClient for handler tests. Every SDK method in design.md
 * §3.4 (plus testConnection) is a vi.fn() with a harmless default, so a test
 * overrides only the calls it cares about:
 *
 *   const client = stubClient({
 *     mobile: { contracts: { get: vi.fn(async () => CONTRACT) } },
 *   });
 *   await handleToolCall(client, "kpn_mobile_contracts_get", { id: 1 });
 *   expect(client.mobile.contracts.get).toHaveBeenCalledWith(1);
 *
 * The result is typed as both the mock tree and a KpnClient, so it can be
 * passed to handlers directly and still expose `.mock` for assertions.
 * Build it inside each test: vitest.config.ts sets `mockReset: true`.
 */
import { vi, type Mock } from "vitest";
import type { KpnClient, QuotaInfo } from "@wyre-ai/node-kpn";

type Methods = Record<string, Mock>;

export interface StubTree {
  disturbances: Methods;
  availability: Methods;
  simSwap: Methods;
  mobile: {
    subscribers: Methods;
    hierarchy: Methods;
    thresholds: Methods;
    invoices: Methods;
    contracts: Methods;
    orders: Methods;
    serviceRequests: Methods;
  };
  testConnection: Mock;
  lastQuota: QuotaInfo | undefined;
}

export interface StubOverrides {
  disturbances?: Methods;
  availability?: Methods;
  simSwap?: Methods;
  mobile?: Partial<Record<keyof StubTree["mobile"], Methods>>;
  testConnection?: Mock;
  lastQuota?: QuotaInfo;
}

export type StubClient = StubTree & KpnClient;

const emptyPage = () => ({ result: [], total: 0 });
const orderSummary = () => ({
  id: 900001,
  operation: "BLOCK_SIM",
  referenceNumber: "WYRE-20260101000000",
  status: "InProgress",
});

export function stubClient(overrides: StubOverrides = {}): StubClient {
  const tree: StubTree = {
    disturbances: {
      getByAddress: vi.fn(async () => ({ broadband: [], fixed: [], mobile: [], generic: [] })),
      ...overrides.disturbances,
    },
    availability: {
      getByAddress: vi.fn(async () => ({ alerts: [] })),
      ...overrides.availability,
    },
    simSwap: {
      retrieveDate: vi.fn(async () => ({ latestSimChange: null })),
      ...overrides.simSwap,
    },
    mobile: {
      subscribers: {
        list: vi.fn(async () => emptyPage()),
        get: vi.fn(async () => ({ id: 1 })),
        listContracts: vi.fn(async () => emptyPage()),
        ...overrides.mobile?.subscribers,
      },
      hierarchy: {
        listChildren: vi.fn(async () => emptyPage()),
        get: vi.fn(async () => ({})),
        ...overrides.mobile?.hierarchy,
      },
      thresholds: {
        list: vi.fn(async () => []),
        listContracts: vi.fn(async () => emptyPage()),
        ...overrides.mobile?.thresholds,
      },
      invoices: {
        list: vi.fn(async () => emptyPage()),
        downloadPdf: vi.fn(async () => ({
          data: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // "%PDF"
          contentType: "application/pdf",
        })),
        ...overrides.mobile?.invoices,
      },
      contracts: {
        list: vi.fn(async () => emptyPage()),
        get: vi.fn(async () => ({ id: 1 })),
        getItems: vi.fn(async () => []),
        getOperations: vi.fn(async () => ({})),
        blockSim: vi.fn(async () => orderSummary()),
        unblockSim: vi.fn(async () => orderSummary()),
        validateSimReplacement: vi.fn(async () => undefined),
        replaceSim: vi.fn(async () => orderSummary()),
        ...overrides.mobile?.contracts,
      },
      orders: {
        list: vi.fn(async () => emptyPage()),
        get: vi.fn(async () => ({ id: 1 })),
        getPretty: vi.fn(async () => ({ id: 1 })),
        authorize: vi.fn(async () => orderSummary()),
        cancel: vi.fn(async () => ({})),
        ...overrides.mobile?.orders,
      },
      serviceRequests: {
        list: vi.fn(async () => emptyPage()),
        get: vi.fn(async () => ({ id: 1 })),
        ...overrides.mobile?.serviceRequests,
      },
    },
    testConnection:
      overrides.testConnection ??
      vi.fn(async () => ({ gateway: { ok: true, level: "demo", applicationName: "fake-app" } })),
    lastQuota: overrides.lastQuota,
  };
  return tree as unknown as StubClient;
}
