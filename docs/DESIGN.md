# kpn-mcp + @wyre-ai/node-kpn — Design (build contract)

Status: v1 design, 2026-09-25, for the **developer.kpn.com** tools.
The default server surface is Grexx/IRMA. See `docs/GREXX.md`.
Those v1 tools stay in the repo and are served only when `KPN_LEGACY_DEVELOPER_API=1`.
If code and this document disagree on the legacy surface, fix one of them in the same PR.
The Grexx surface is specified in `docs/GREXX.md`, not here.

- SDK repo: `/Users/asachs/work/wyre/engineering/projects/mcp/mcp-servers/node-kpn` (package `@wyre-ai/node-kpn`)
- Server repo: `/Users/asachs/work/wyre/engineering/projects/mcp/mcp-servers/kpn-mcp` (package `@wyre-ai/kpn-mcp`)
- Reference repos to mirror (read them before writing code):
  - SDK: `node-connectwise-cpq`. Zero-dep native fetch, error hierarchy, token-bucket rate limiter, `resources/`, `types/`, MSW tests, tsup dual ESM/CJS.
  - Server: `connectwise-cpq-mcp`. SDK v2 split packages, `createMcpHandler({ legacy: 'stateless' })`, `McpServerFactory`, 401 gate, MRTR elicitation, `confirmDestructive`, destructive-warning lint, dual-era smoke script.
- Research inputs: `…/scratchpad/kpn-research/{portal,service,network,identity,comms}.md` and the original OAS files in `…/kpn-research/raw/kpnrepo/openapi/_original/`.

---

## 1. Scope

### 1.1 In v1

v1 covers four genuine KPN products. All four sit behind the KPN Apigee gateway at `https://api-prd.kpn.com`.

| # | Product | Base path | Token realm | Why it is in |
|---|---|---|---|---|
| 1 | **Disturbance Check** (storingen) | `/network/kpn/disturbance-check` | gateway | Relevance 4. Free, self-serve, read-only. Answers "is KPN down at customer X's address?" |
| 2 | **Internet Speed Check** (availability by address) | `/network/kpn/internet-speed-check` | gateway | Relevance 4. Free, self-serve, read-only. Answers "what access and speeds can this site get, and when is fibre planned?" |
| 3 | **SIM Swap** (retrieve date) | `/kpn/sim-swap` | gateway | Relevance 3. A read-only helpdesk anti-social-engineering check before any SMS-MFA reset. A SwaggerHub mock exists. |
| 4 | **Mobile Services Management (MSM) v11** (KPN Zakelijk business mobile) | `/mobile/kpn/mobileservices` | msm | Relevance 5. Subscribers, contracts/SIMs, orders, service requests, invoices, thresholds, hierarchy. Also block/unblock/replace SIM and order authorize/cancel, each behind confirmation. |

v1 has **23 tools**. That is ≤ 25, so the surface is **flat with no router**, as in connectwise-cpq-mcp.

### 1.2 Out of v1, and why

| Product | Reason |
|---|---|
| SD-LAN/SD-WAN Network View (Meraki v1 proxy, `/kpn/meraki`) | Relevance 4, but it is the Cisco Meraki Dashboard API verbatim. The fleet already has `node-meraki` and `meraki-mcp`, and the right fix is there: add a `baseUrl` override plus a pluggable bearer-token provider (the KPN OAuth token) to `node-meraki`. Do **not** duplicate 300 Meraki ops here. It has no `GET /organizations`, so users must supply the orgId. **v2 follow-up, in meraki-mcp.** |
| ServiceNow Customer Connect (`/network/kpn/servicenow`) | Relevance 3, but it is a partner e-bonding interface and KPN must onboard you. Valid `service` and `ci` values are undocumented. Candidate for v2 once WYRE is onboarded. |
| KPN SMS send (`/communication/kpn/sms`) | Billable, reaches real people, and cannot be undone. It is send-only: no status or history endpoint, and DLRs arrive only by webhook. WYRE has other notification channels. Candidate for v2 behind confirmation. |
| MSM terminate / porting-out / move / contracting basket / roles / subscriber create-update-delete / hierarchy writes / thresholds writes / Apple DEP / Knox / return-hardware / business voicemail / addresses | Terminate and port-out are irreversible and cost money. The basket is a stateful multi-step flow. Role edits change privileges. The rest are niche. Keep them out until v1 read and SIM tools prove themselves. |
| Number Verify | It is a handset-bound consumer auth flow: `/session` must be called from the end user's phone over mobile data. Paid per call. Has its own token endpoint. |
| LoRa ThingPark | IoT niche. Needs a LoRa contract plus `POST /activate` with ThingPark credentials. Returns HTTP 500 for bad tokens. |
| ISE (managed Cisco ISE) | The spec is too thin (empty schemas, copy-pasted descriptions). Internal-user writes carry passwords. |
| Wholesale WBA FPI/CIP, FTTH HLD | Only for wholesale partners and ISPs. Speed Check covers the MSP use case. |
| Webhook config and signing keys | Platform plumbing. `…/keys/reveal` exposes HMAC secrets and must never be reachable by an LLM. |
| Vonage, Apidaze, WeSeeDo, Parley, Xdroid, Registered E-mail, Tracebuzz, Polly.help, iTV, Eneco, FIAM | Resold third-party CPaaS, or not a KPN customer surface at all, or data-space plumbing. None serves an MSP helpdesk. |

---

## 2. Auth model

### 2.1 Token endpoints (Apigee client credentials)

| Realm | Token URL (relative to base URL) | Used by |
|---|---|---|
| `gateway` | `POST /oauth/client_credential/accesstoken?grant_type=client_credentials` | Disturbance, Speed Check, SIM Swap |
| `msm` | `POST /oauth/grip/msm/accesstoken?grant_type=client_credentials` | MSM |

The request is the same for both realms:
- `grant_type` goes in the **query string**.
- The body is `application/x-www-form-urlencoded` with `client_id` and `client_secret`.
- Send `Accept: application/json`. No Basic auth.

The 200 body is an Apigee token in which **every value is a string**:

```json
{"access_token":"…","token_type":"Bearer","expires_in":"3599","issued_at":"1587458037687",
 "scope":"","refresh_token":"","level":"demo","application_name":"…","status":"approved", …}
```

- Parse `expires_in` with `Number()`. Accept a string or a number.
- There is no refresh token, so re-mint when the token expires.
- `level` (`demo` or `prod`) is the account tier. Surface it in `kpn_test_connection`.

A token-endpoint error looks like `401 {"ErrorCode":"invalid_client","Error":"ClientId is Invalid"}`. Map it to `AuthenticationError` with `code = 'invalid_client'`.

### 2.2 Caching and refresh (`src/auth.ts`)

- `KpnTokenProvider implements AuthProvider`. There is one instance per realm, and its constructor takes `{ baseUrl, tokenPath, clientId, clientSecret, cache }`.
- **The cache is process-wide**, not per client. HTTP mode builds a fresh MCP server and SDK client on **every request**, so a per-instance cache would mint a token for every tool call.
  - `TokenCache` is a `Map` keyed by `sha256(baseUrl + tokenPath + clientId + clientSecret)`. Hashing the secret means a rotated secret never reuses a cached token, and no raw secret sits in a key.
  - The map is bounded at 500 entries. When full, evict the oldest-inserted entry.
  - The SDK exports a module-level `defaultTokenCache`. `KpnConfig.tokenCache` may override it; tests pass a fresh one.
- A cached token is valid while `now < issuedAtLocal + expires_in*1000 - 300_000`. That is a 5-minute safety margin, which works out to about 55 minutes of use.
- **Single-flight minting.** Concurrent `headers()` calls for the same key await one in-flight promise. If minting fails, drop the in-flight promise so the next call tries again.
- `handleUnauthorized()` evicts the key and returns `true`, and HttpClient then retries the request **once**. A 401 from the *token* endpoint is terminal and is never retried.
- These responses count as "unauthorized" and trigger the refresh path:
  - HTTP 401, regardless of body.
  - Any status whose body carries an Apigee fault with `detail.errorcode` in `oauth.v2.InvalidAccessToken`, `oauth.v2.AccessTokenExpired` or `keymanagement.service.invalid_access_token`.

### 2.3 Per-product entitlement caveat

- Credentials belong to a KPN API Store **project**. No OAuth scopes are used; Apigee decides entitlement per project and product. A token mints successfully even when the project does **not** include a product. That call then fails with 401 or 403 (Apigee `fault`, or KPN `error` with a `name` such as `Forbidden`).
  - `ForbiddenError`'s message must say: *"The KPN project behind these credentials is not entitled to this API product (add it to the project in developer.kpn.com), or the MSM user lacks the required GRIP privilege."*
- **MSM is per end customer.** The MSM token is bound to one customer's GRIP user, and every call is checked against that user's privileges (`privileges_orders_authorization` and similar). One gateway connection therefore equals one KPN business customer. There is no reseller or multi-customer endpoint.
- Test and production use the **same host and keys**. The tier (`level`) lives on the account. There is no sandbox host to switch to (`api-acc` and `api-tst` are KPN-internal), so there is **no environment selector**.

### 2.4 Credential inputs

| Env var (stdio/env mode) | Gateway header (AUTH_MODE=gateway) | Required | Purpose |
|---|---|---|---|
| `KPN_CLIENT_ID` | `X-KPN-Client-Id` | yes | API Store project client id (gateway realm; also the MSM fallback) |
| `KPN_CLIENT_SECRET` | `X-KPN-Client-Secret` | yes | project secret |
| `KPN_MSM_CLIENT_ID` | `X-KPN-MSM-Client-Id` | no | customer's GRIP-bound MSM app id. Falls back to `KPN_CLIENT_ID` when absent. |
| `KPN_MSM_CLIENT_SECRET` | `X-KPN-MSM-Client-Secret` | no, but must be paired with the MSM id | MSM secret |
| `KPN_BASE_URL` | none (deliberately) | no | Default `https://api-prd.kpn.com`. **Env mode only.** A header-controlled base URL would make the gateway send client secrets to, and fetch from, an attacker-chosen host (SSRF plus credential exfiltration). |

**401 gate** (`src/index.ts`, gateway mode, before serving) rejects the request when:
- `X-KPN-Client-Id` or `X-KPN-Client-Secret` is missing, or
- exactly one of `X-KPN-MSM-Client-Id` / `X-KPN-MSM-Client-Secret` is present (a half pair).

It never falls through to env credentials. The response body mirrors CPQ: JSON-RPC error `-32001` with `data.required = ["X-KPN-Client-Id","X-KPN-Client-Secret"]`.

---

## 3. SDK: `@wyre-ai/node-kpn`

### 3.1 Conventions (mirror node-connectwise-cpq)

- Zero runtime dependencies: native `fetch` and `node:crypto` only. Node ≥ 20. tsup builds ESM + CJS + d.ts. Tests use vitest + MSW 2 with `onUnhandledRequest: 'error'`.
- Every file uses ESM `.js` import suffixes. Types are hand-written TS interfaces, and every field is optional unless the spec marks it required.
- **HttpClient** (`src/http.ts`):
  - Timeout: `AbortSignal.timeout(30_000)`.
  - Read response bodies as text, then `JSON.parse`.
  - Strip trailing slashes from the base URL and paths.
  - **Array query params serialize as repeated keys** (`status=A&status=B`), because the MSM spec uses `collectionFormat: multi`.
  - `api-version` is never sent (the default is latest).
- **Retry policy (safety-critical):**
  - Retry only when `options.idempotent === true`. The default is `method === 'GET'`.
  - Read-only POSTs set `idempotent: true` explicitly: `/offer`, `/retrieve-date`, `/order/replace-sim/validator`.
  - **MSM order POSTs are never retried**, whether the failure is 5xx, a network error or 429. A duplicate block-sim or authorize is a real-world side effect. Retry does not apply to them.
  - When retry does apply, it covers network errors, 429, 500, 502, 503 and 504. The backoff is `min(1000·2^(n-1), 30s)`, and `Retry-After` is honoured.
  - The 401 refresh-and-retry-once in §2.2 applies to **all** methods. A 401 means the request was rejected, so repeating it is safe.
- **Binary responses:** `RequestOptions.responseType?: 'json' | 'binary'`. With `binary`, the client returns `{ data: Uint8Array; contentType: string; filename?: string }`. The filename is parsed from `Content-Disposition`.
- **Quota headers:** after each response, HttpClient stores `lastQuota: QuotaInfo | undefined`, parsed from `quota-limit`, `quota-used`, `quota-interval`, `quota-time-unit`, `quota-reset-UTC` and `sunset`. `KpnClient.lastQuota` returns the most recent value from either realm.
- **Rate limiter:** a single shared token bucket at 25 requests per 5 s. KPN publishes no numbers; 429s surface as `RateLimitError` carrying the quota info.
- **Error parsing** (`parseKpnError(status, body)` in `errors.ts`). Handle every envelope:
  - Apigee: `{fault:{faultstring, detail:{errorcode}}}`. `code` = errorcode, `message` = faultstring.
  - KPN proxy: `{error:{transactionId,status,name,message,info}}`.
  - MSM / legacy flat: `{transactionId,status,name,message,info}`.
  - CAMARA (SIM Swap): `{status,code,message}`, for example `code: "SIM_SWAP.UNKNOWN_PHONE_NUMBER"`.
  - Token endpoint: `{ErrorCode,Error}`.
  - Fallback: raw text.

### 3.2 File list (exact)

```
node-kpn/
  package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  .releaserc.json  .npmrc  .gitignore
  README.md  CHANGELOG.md  CONTRIBUTING.md  LICENSE  .github/workflows/release.yml
  src/
    index.ts            # public exports (every class/type below)
    config.ts           # DEFAULT_BASE_URL, TOKEN_PATHS, PRODUCT_PATHS, KpnConfig
    auth.ts             # AuthProvider, KpnTokenProvider, TokenCache, defaultTokenCache
    errors.ts           # KpnError + subclasses, parseKpnError
    http.ts             # HttpClient, RequestOptions, QuotaInfo parsing
    rate-limiter.ts     # RateLimiter (copy of CPQ's)
    client.ts           # KpnClient, MobileNamespace
    msm.ts              # MSM helpers: buildFilters, MsmPageParams, referenceNumber()
    resources/
      disturbances.ts           availability.ts           sim-swap.ts
      mobile-subscribers.ts     mobile-hierarchy.ts       mobile-thresholds.ts   mobile-invoices.ts
      mobile-contracts.ts       mobile-orders.ts          mobile-service-requests.ts
    types/
      index.ts  common.ts
      disturbance.ts  availability.ts  sim-swap.ts
      mobile-subscriber.ts  mobile-hierarchy.ts  mobile-threshold.ts  mobile-invoice.ts
      mobile-contract.ts  mobile-order.ts  mobile-service-request.ts
  tests/
    setup.ts  helpers.ts
    mocks/server.ts  mocks/handlers.ts  mocks/handlers-oauth.ts
    mocks/handlers-network.ts  mocks/handlers-mobile-org.ts  mocks/handlers-mobile-orders.ts
    fixtures/oauth.ts  fixtures/network.ts  fixtures/mobile-org.ts  fixtures/mobile-orders.ts
    auth.test.ts  http.test.ts  errors.test.ts  msm.test.ts  rate-limiter.test.ts  client.test.ts
    disturbances.test.ts  availability.test.ts  sim-swap.test.ts
    mobile-subscribers.test.ts  mobile-hierarchy.test.ts  mobile-thresholds.test.ts  mobile-invoices.test.ts
    mobile-contracts.test.ts  mobile-orders.test.ts  mobile-service-requests.test.ts
```

### 3.3 Core API (owned by SDK-CORE)

```ts
// config.ts
export const DEFAULT_BASE_URL = 'https://api-prd.kpn.com';
export const TOKEN_PATHS = {
  gateway: '/oauth/client_credential/accesstoken',
  msm: '/oauth/grip/msm/accesstoken',
} as const; // HttpClient appends ?grant_type=client_credentials
export const PRODUCT_PATHS = {
  disturbance: '/network/kpn/disturbance-check',
  availability: '/network/kpn/internet-speed-check',
  simSwap: '/kpn/sim-swap',
  msm: '/mobile/kpn/mobileservices',
} as const;
export interface KpnConfig {
  clientId: string;
  clientSecret: string;
  msmClientId?: string;       // falls back to clientId
  msmClientSecret?: string;   // falls back to clientSecret; must be paired with msmClientId
  baseUrl?: string;           // default DEFAULT_BASE_URL
  maxRetries?: number;        // default 3 (idempotent requests only)
  tokenCache?: TokenCache;    // default defaultTokenCache
}

// auth.ts
export interface AuthProvider {
  headers(): Promise<Record<string, string>>;
  handleUnauthorized?(): Promise<boolean>;
}
export interface KpnToken {
  accessToken: string; expiresAt: number; level?: string; applicationName?: string;
}
export class TokenCache {
  constructor(maxEntries?: number /* 500 */);
  get(key: string): KpnToken | undefined;
  set(key: string, token: KpnToken): void;
  delete(key: string): void;
  clear(): void;
}
export const defaultTokenCache: TokenCache;
export class KpnTokenProvider implements AuthProvider {
  constructor(opts: { baseUrl: string; tokenPath: string; clientId: string; clientSecret: string; cache: TokenCache });
  headers(): Promise<Record<string, string>>;  // { Authorization: 'Bearer …' }
  handleUnauthorized(): Promise<boolean>;      // evict + true
  getToken(): Promise<KpnToken>;               // used by testConnection
}

// errors.ts — all extend KpnError(message, statusCode, response, code?, transactionId?)
export class KpnError extends Error { statusCode: number; response: unknown; code?: string; transactionId?: string }
export class AuthenticationError extends KpnError {} // 401 (+ Apigee invalid-token faults on any status)
export class ForbiddenError extends KpnError {}      // 403 — entitlement / GRIP privilege message (§2.3)
export class NotFoundError extends KpnError {}       // 404
export class ValidationError extends KpnError {}     // 400 (code from MSM error tables when present)
export class ConflictError extends KpnError {}       // 409 (SIM Swap concurrent request)
export class RateLimitError extends KpnError { retryAfter: number; quota?: QuotaInfo } // 429
export class ServerError extends KpnError {}         // 5xx
export function parseKpnError(status: number, body: unknown, headers?: Headers): KpnError;

// http.ts
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | Array<string | number> | undefined>;
  body?: unknown;              // JSON-encoded
  headers?: Record<string, string>;  // e.g. Content-Language
  idempotent?: boolean;        // default: method === 'GET'
  responseType?: 'json' | 'binary';
}
export interface BinaryResponse { data: Uint8Array; contentType: string; filename?: string }
export interface QuotaInfo { limit?: number; used?: number; interval?: string; timeUnit?: string; resetUtc?: string; sunset?: string }
export class HttpClient {
  constructor(cfg: { baseUrl: string; rateLimiter: RateLimiter; auth?: AuthProvider; maxRetries?: number });
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  readonly lastQuota: QuotaInfo | undefined;
}

// msm.ts
export interface MsmPageParams { from?: number; to?: number; sortBy?: string; order?: 'ASC' | 'DESC' }
/** { FIRSTNAME: ['Jan'], MOBILE_NUMBER: ['0612345678'] } → 'FIRSTNAME: "Jan"; MOBILE_NUMBER: "0612345678"'.
 *  Values are double-quoted with inner quotes backslash-escaped; empty arrays/undefined dropped; returns undefined if empty. */
export function buildFilters(filters: Record<string, Array<string> | undefined>): string | undefined;
/** Default MSM referenceNumber (≤ 25 chars): 'WYRE-' + UTC yyyyMMddHHmmss. */
export function referenceNumber(now?: Date): string;

// client.ts
export class KpnClient {
  constructor(config: KpnConfig);  // throws synchronously on empty clientId/clientSecret or half MSM pair
  readonly disturbances: DisturbancesResource;
  readonly availability: AvailabilityResource;
  readonly simSwap: SimSwapResource;
  readonly mobile: {
    subscribers: MobileSubscribersResource;
    hierarchy: MobileHierarchyResource;
    thresholds: MobileThresholdsResource;
    invoices: MobileInvoicesResource;
    contracts: MobileContractsResource;
    orders: MobileOrdersResource;
    serviceRequests: MobileServiceRequestsResource;
  };
  /** Mint (or read cached) tokens. MSM is attempted only if `includeMsm`. Never throws for MSM; reports per realm. */
  testConnection(opts?: { includeMsm?: boolean }): Promise<{
    gateway: { ok: boolean; level?: string; applicationName?: string; error?: string };
    msm?: { ok: boolean; level?: string; applicationName?: string; error?: string };
  }>;
  readonly lastQuota: QuotaInfo | undefined;
}
```

`KpnClient` builds **two** HttpClients that share one RateLimiter:
- `gatewayHttp`, with the `gateway` token provider;
- `msmHttp`, with the `msm` token provider and the MSM credentials.

Resource constructors take `(http: HttpClient)`. **Resource paths are absolute from the host**: every resource prefixes `PRODUCT_PATHS.x` itself.

`types/common.ts` (core):

```ts
export interface LocalizedString { en?: string; nl?: string }
export interface MsmPage<T> { result: T[]; total: number }
export type OrderSummaryStatus = 'Failed'|'Aborted'|'Finished'|'Suspended'|'InProgress'|'Waiting'|'Draft'|'WaitingForAuthorization';
export interface OrderSummary { id?: number; operation?: string; referenceNumber?: string; status?: OrderSummaryStatus | string; contextName?: string; creationDate?: string }
export type { QuotaInfo } from '../http.js';
```

`OrderSummary.status` is typed `| string` because the spec's enum value is truncated to `WaitingForAuthorizati`.

### 3.4 Domain resources: exact signatures

**Network (SDK-NET), gateway realm**

```ts
// resources/disturbances.ts
export class DisturbancesResource {
  /** GET {disturbance}/address?zip_code&house_number&house_number_extension */
  getByAddress(a: { zipCode: string; houseNumber: string | number; houseNumberExtension?: string }): Promise<DisturbanceResult>;
}
// types/disturbance.ts
export interface Disturbance { id?: number; type?: string; cause?: string; source?: string; service?: string; state?: string;
  start_date?: string; end_date?: string; region?: string; description?: string; long_description?: string; info?: string;
  affected_elements_count?: number; affected_customers_count?: number; serviceguard_ticket_id?: string; created_at?: string;
  communication_type?: string }
export interface DisturbanceResult { broadband: Disturbance[]; fixed: Disturbance[]; mobile: Disturbance[]; generic: Disturbance[];
  alerts?: Array<{ code?: string; description?: string; code_message?: string }> }  // arrays default to [] when absent

// resources/availability.ts
export class AvailabilityResource {
  /** POST {availability}/offer { service_address:{zip_code, house_number:int, house_number_extension} }  (idempotent: true) */
  getByAddress(a: { zipCode: string; houseNumber: number; houseNumberExtension?: string }): Promise<AvailabilityResult>;
}
// types/availability.ts — NORMALIZED: `max_bandwidth` → `bandwidth`; `alerts` object → array (see research §7)
export interface Technology { name?: 'FIBER' | 'COPPER' | 'NoAccess' | string; download?: number; upload?: number }
export interface AvailabilityResult {
  available_on_address?: { technologies?: Technology[]; house_number_extensions?: string[] };
  fixed_info?: { copper_access?: boolean; fiber_access?: boolean; hybrid_access?: boolean; mobile_access?: boolean };
  fiber_info?: { thirdparty_delivery?: boolean; thirdparty_permission?: boolean; thirdparty_name?: string; construction_type?: string;
    planned_fiber_to_the_home_date?: string; planned_fiber_to_the_home_description?: string; civil_date?: string;
    wholesale_broadband_access_plan_date?: string; wholesale_broadband_access_plan_date_description?: string; nl_type?: string; phase?: string };
  bandwidth?: { up?: number; down?: number };
  alerts: Array<{ code?: string; description?: string; code_message?: string }>;
}

// resources/sim-swap.ts
export class SimSwapResource {
  /** POST {simSwap}/retrieve-date { phoneNumber } (E.164 with '+')  (idempotent: true).
   *  404 SIM_SWAP.UNKNOWN_PHONE_NUMBER → NotFoundError(code); 409 → ConflictError. */
  retrieveDate(phoneNumber: string): Promise<{ latestSimChange: string | null }>;
}
```

**Mobile org (SDK-MOB-ORG), msm realm**. Every path is under `PRODUCT_PATHS.msm`.

```ts
// resources/mobile-subscribers.ts
export class MobileSubscribersResource {
  list(p?: MsmPageParams & { patterns?: string[]; filters?: string; userOnly?: boolean }): Promise<MsmPage<Subscriber>>;   // GET /hierarchy/subscribers
  get(id: number): Promise<SubscriberDetails>;                                                                            // GET /hierarchy/subscribers/{id}
  listContracts(subscriberId: number, p?: MsmPageParams): Promise<MsmPage<Contract>>;                                     // GET /hierarchy/subscribers/{id}/contracts
}
// resources/mobile-hierarchy.ts
export class MobileHierarchyResource {
  listChildren(p?: { id?: number; pattern?: string; includeCustomer?: boolean; includeGroups?: boolean; from?: number; to?: number }): Promise<MsmPage<HierarchyItem>>; // GET /hierarchy/children
  get(id: number): Promise<HierarchyItemDetails>;                                                                         // GET /hierarchy/children/{id}
}
// resources/mobile-thresholds.ts
export class MobileThresholdsResource {
  list(): Promise<Threshold[]>;                                                                                           // GET /contract/thresholds
  listContracts(thresholdId: number, p?: MsmPageParams): Promise<MsmPage<Contract>>;                                      // GET /contract/thresholds/{id}/contracts
}
// resources/mobile-invoices.ts
export class MobileInvoicesResource {
  list(p?: MsmPageParams & { debtorId?: number; pattern?: string; searchFrom?: string; searchTo?: string; type?: string }): Promise<MsmPage<Invoice>>; // GET /finances/invoices
  downloadPdf(id: number): Promise<BinaryResponse>;                                                                       // GET /finances/invoices/{id} (binary)
}
```

Types (`types/mobile-subscriber.ts`, `mobile-hierarchy.ts`, `mobile-threshold.ts`, `mobile-invoice.ts`) take their fields from service.md §1a, §1g, §1f and §1e:
- `Subscriber`: `id`, `firstName`, `lastName`, `prefix`, `employeeNumber`, `fixedNumber`, `gripUser`, `user`, `contracts{amount, firstPhoneNumber}`, `path`
- `SubscriberDetails`
- `HierarchyItem`: `id`, `type` ('CUSTOMER'|'DEBTOR'|'SUBSCRIBER'|'COST_CENTER'|'CUSTOM_GROUP'|'BUSINESS_LOCATION'), `name`, `costCenterNumber`, `firstName`, `lastName`, `email`, `employeeNumber`, `path`, `operation`
- `HierarchyItemDetails`: `customer`, `debtor`, `businessLocation`, `costCenter`
- `Threshold`: `id`, `name`, `type` ('DATA_NATIONAL_MB'|'DATA_ROAMING_MB'|'VOICE_NATIONAL_MIN'|'VOICE_ROAMING_EUR'), `dailyValue`
- `Invoice`: `id`, `number`, `date`, `payBeforeDate`, `debtorName`, `totalAmountToPayInCents`, `type`

`Contract` is imported from `types/mobile-contract.ts`, which is owned by SDK-MOB-ORD.

**Mobile contracts & orders (SDK-MOB-ORD), msm realm**

```ts
// resources/mobile-contracts.ts
export class MobileContractsResource {
  list(p?: MsmPageParams & { patterns?: string[]; filters?: string; category?: string; language?: 'en' | 'nl' }): Promise<MsmPage<Contract>>; // GET /contract/all (Content-Language header)
  get(id: number): Promise<ContractDetails>;                         // GET /contract/id/{id}  — RAW (includes pin/puk; masking is the server's job)
  getItems(id: number): Promise<ContractItem[]>;                     // GET /contract/id/{id}/items
  getOperations(contractId: number): Promise<OperationsAvailability>;// GET /order/operations?contractId=
  blockSim(b: { contractId: number; referenceNumber: string }): Promise<OrderSummary>;    // POST /order/block-sim   (NOT idempotent)
  unblockSim(b: { contractId: number; referenceNumber: string }): Promise<OrderSummary>;  // POST /order/unblock-sim (NOT idempotent)
  validateSimReplacement(b: { contractId: number; newSimCardNumber: string }): Promise<void>; // POST /order/replace-sim/validator (idempotent: true; 2xx = valid, 400 = ValidationError(code))
  replaceSim(b: { contractId: number; newSimCardNumber?: string; esim: boolean; email?: string; confirmationCode?: string;
                  referenceNumber: string; wishDate?: string }): Promise<OrderSummary>;  // POST /order/replace-sim (NOT idempotent)
}
// resources/mobile-orders.ts
export class MobileOrdersResource {
  list(p: MsmPageParams & { status: OrderStatus[]; patterns?: string[]; currentUserOrdersOnly?: boolean; withRequiredActionFirst?: boolean }): Promise<MsmPage<Order>>; // GET /track-and-trace/orders
  get(id: number): Promise<OrderDetails>;                           // GET /track-and-trace/orders/{id}
  getPretty(id: number): Promise<unknown>;                          // GET /track-and-trace/orders/{id}/pretty
  authorize(orderId: number): Promise<OrderSummary>;                // POST /order/authorize {orderId} (NOT idempotent)
  cancel(id: number, note?: string): Promise<unknown>;              // POST /track-and-trace/orders/{id}/cancel?note=… (query param per MSM OAS; NOT idempotent)
}
// resources/mobile-service-requests.ts
export class MobileServiceRequestsResource {
  list(p: MsmPageParams & { status: OrderStatus[]; patterns?: string[]; currentUserOrdersOnly?: boolean; language?: 'en' | 'nl' }): Promise<MsmPage<ServiceRequest>>; // GET /track-and-trace/service-requests
  get(id: number): Promise<ServiceRequestDetails>;                  // GET /track-and-trace/service-requests/{id}
}
```

- `types/mobile-contract.ts`:
  - `Contract`: `id`, `category`, `productCategory`, `product: LocalizedString`, `firstName`, `lastName`, `namePrefix`, `mobileNumber`, `fixedNumber`, `extension`, `simCardNumber`, `imei`, `sipAccount`, `state` ('ACTIVE'|'CLOSED'|'ORDERED'|'PENDING'|'BLOCKED')
  - `ContractDetails`: the service.md §1b field list, including `pin` and `puk`
  - `ContractItem`: a recursive tree
  - `OperationAvailability`: `{enabled?, visible?, blockingOrders?: BlockingOrder[]}`
  - `OperationsAvailability`: `{contractId?, blockSim?, unblockSim?, replaceSim?, modify?, move?, terminate?, portOut?, separateFixedMobile?, combineFixedMobile?, [k: string]: unknown}`
- `types/mobile-order.ts`:
  - `OrderStatus` = 'IN_PROGRESS'|'UNAUTHORIZED'|'NEW'|'CLOSED'|'CANCELED'|'REJECTED'|'DRAFT'|'THIRD_PARTY'|'HOLD_CUSTOMER'|'WAITING' (per MSM OAS; corrected at integration)
  - `Order`
  - `OrderDetails` (service.md §1d)
- `types/mobile-service-request.ts`:
  - `ServiceRequest`
  - `ServiceRequestDetails`

### 3.5 Test requirements (every domain unit)

- Put fixtures in `tests/fixtures/<domain>.ts`, typed against the SDK types. The data is fictional, with no real names or numbers.
- Put MSW handlers in `tests/mocks/handlers-<domain>.ts`, exported as `<domain>Handlers`, with URLs `https://api-prd.kpn.com/...`.
- Cover each method's happy path and query/body serialization. Assert repeated `status` keys, the `filters` string and the `Content-Language` header.
- Cover error paths 401 → `AuthenticationError`, 403 → `ForbiddenError`, 404 → `NotFoundError`, 429 → `RateLimitError`, 500 → `ServerError`, all with `maxRetries: 0`.
- **For every non-idempotent POST, assert that a 502 is not retried**: the handler is hit exactly once.
- Network-only cases:
  - availability: `max_bandwidth` and alerts-as-object normalization.
  - sim-swap: 404 `SIM_SWAP.UNKNOWN_PHONE_NUMBER` sets `.code`.
- Core owns `tests/helpers.ts`:
  - `makeClient({ maxRetries = 0, msm = true })`, which passes a fresh `TokenCache`;
  - `BASE`;
  - `respondWithError(method, path, status, body?)`.
- Core owns `handlers-oauth.ts`, which answers both token paths with the string-valued Apigee body.

---

## 4. Server: `kpn-mcp`

### 4.1 Architecture (mirror connectwise-cpq-mcp exactly)

- `src/entry.ts` is the stdio guard. `src/index.ts` handles transports, CORS, `/health`, the `/mcp` 401 gate, and `createMcpHandler(factory, { legacy: 'stateless' })` + `toNodeHandler`. stdio uses `serveStdio`.
- `src/mcp-server.ts` is side-effect free and provides:
  - `SERVER_NAME = 'kpn-mcp'`
  - `GATEWAY_HEADERS = ['X-KPN-Client-Id','X-KPN-Client-Secret','X-KPN-MSM-Client-Id','X-KPN-MSM-Client-Secret']`, all of which go into the CORS allow-list
  - `buildCredentials`, `resolveGatewayCredentials`, `resolveEnvCredentials`, `makeMcpServerFactory` and `createMcpServer(creds?)`
  - The KpnClient is built lazily inside `tools/call`.
  - `tools/list` returns the module-scope `TOOLS` array **by reference**.
  - Capabilities are `{ tools: {} }` only. v1 has no MCP Apps card and no resources.
- `src/elicitation.ts` is copied verbatim from connectwise-cpq-mcp: `confirmDestructive`, `CONFIRM_ARG = 'confirm_destructive_action'`, `CONFIRM_ARG_PROPERTY`, and the MRTR `inputRequired` seam.
- **MRTR rule:** every read and every elicitation happens before the single mutating vendor call, which is always the last operation. A retried request re-runs the handler from the top.
- Scripts: `scripts/smoke-dual-era.mjs`, where the gateway leg posts the `X-KPN-*` headers, and `scripts/lint-destructive-warnings.mjs`, copied verbatim.
- Every handler **catches all errors** and returns `isError` results; it never throws.
- An empty or not-found result returns `isError: true` with an explicit "no X found" message, never a bare empty success. This follows the mcp-empty-result-hallucination skill.
- `describeKpnError`: `KPN error (HTTP {status}{, code}): {message}`. It includes `transactionId` when present and **never** echoes request headers or credentials.
- A missing-MSM-credential case cannot happen, because the MSM realm falls back to the main credentials. MSM 401/403 errors must still append the hint: *"MSM requires a customer GRIP-bound MSM app; set X-KPN-MSM-Client-Id/Secret for this customer."*

### 4.2 Shared handler conventions (core)

- `src/handlers/results.ts`: CPQ's helpers plus `requireInteger`, `optionalStringArray` and `optionalEnum(args, key, allowed)`.
  - `ToolResult.content` also allows `{ type: 'resource'; resource: { uri: string; mimeType: string; blob: string } }`.
- `src/handlers/paging.ts`: `toMsmPage(args)` maps tool `offset` (default 0) and `limit` (default 20, max 100) to `{ from: offset, to: offset + limit }`.
  - `pageMeta(page, offset, limit)` returns `{ total, offset, limit, returned, hasMore }`.
- `src/handlers/addresses.ts`:
  - `normalizeZip` uppercases, strips spaces and validates `^[1-9][0-9]{3}[A-Z]{2}$`.
  - `normalizeNlMobile` turns `06xxxxxxxx`, `316xxxxxxxx` or `+316…` into `+316xxxxxxxx`. Other `+`-prefixed E.164 numbers pass through, and anything else is a `ToolInputError`.
- `src/handlers/masking.ts`: `maskContract(details)` replaces `pin` and `puk` with `"••••"`, plus `pinPukMasked: true`, whenever those fields are present. **Every tool that returns contract details goes through it, with no exceptions.**
- Reference numbers: tools accept an optional `referenceNumber` (≤ 25 chars, validated) and default to the SDK's `referenceNumber()`.

### 4.3 Tool surface: 23 tools, flat, fixed order

Tier key: **R** = read (`{readOnlyHint: true, openWorldHint: true}`). **W** = write. **D** = destructive or high-impact: carries a `⚠ DESTRUCTIVE` or `⚠ HIGH-IMPACT` description prefix, inline annotations `{readOnlyHint:false, destructiveHint:true, idempotentHint:false, openWorldHint:true}`, `...CONFIRM_ARG_PROPERTY` in `properties`, a description ending *"Confirm with the user before invoking."*, and handling via `confirmDestructive`. **S** = sensitive read: `⚠ HIGH-IMPACT` prefix and gated by `confirmDestructive`, but annotated `readOnlyHint: true` because it changes no state.

Common params:
- Address tools take `zipCode` (string, "1234AB"), `houseNumber` (integer) and `houseNumberExtension` (string, optional).
- MSM lists take `offset` (int, ≥ 0) and `limit` (int, 1–100, default 20).
- MSM ids are integers.

| # | Tool | Tier | Description (use as-is, prefixes exact) | Input schema (required*) | SDK call(s) |
|---|---|---|---|---|---|
| 1 | `kpn_test_connection` | R | Verify KPN API Store credentials by minting OAuth tokens. Reports the account tier (demo/prod), app name, whether the MSM (business mobile) token also mints, and the last quota headers. Minting does not prove a product is enabled on the project. | `includeMsm` bool (default true) | `client.testConnection()` |
| 2 | `kpn_disturbances_check` | R | Check for current and planned KPN network outages/maintenance (broadband, fixed, mobile, generic) affecting a Dutch address. Use first when a customer site on KPN reports connectivity problems. | `zipCode`*, `houseNumber`*, `houseNumberExtension` | `disturbances.getByAddress` |
| 3 | `kpn_availability_check` | R | Look up which KPN access technologies (fibre/copper) and max download/upload speeds are available at a Dutch address, plus planned fibre dates and third-party fibre info. For site surveys, upgrades and pre-sales. | `zipCode`*, `houseNumber`*, `houseNumberExtension` | `availability.getByAddress` |
| 4 | `kpn_sim_swap_get_date` | R | Get the date of the most recent SIM swap on a KPN mobile number. Use before resetting SMS-based MFA or passwords to detect SIM-swap fraud. KPN NL numbers only. | `phoneNumber`* (06…/+316…), `maxAgeHours` int (optional; adds `swappedWithinMaxAge` boolean) | `simSwap.retrieveDate` |
| 5 | `kpn_mobile_subscribers_list` | R | Search KPN business-mobile subscribers (employees) by name, employee number or fixed number. | `search` string, `firstName`, `lastName`, `employeeNumber`, `fixedNumber` (strings → FIRSTNAME/LASTNAME/EMPLOYEE_NUMBER/FIXED_NUMBER filters), `offset`, `limit` | `mobile.subscribers.list` |
| 6 | `kpn_mobile_subscribers_get` | R | Get a subscriber's details and (by default) their mobile/fixed contracts. | `id`*, `includeContracts` bool (default true) | `subscribers.get` (+ `listContracts` 0–100) |
| 7 | `kpn_mobile_contracts_list` | R | Search KPN business-mobile contracts (SIMs/lines) by phone number, SIM card number (ICCID), IMEI, name, product or state. Pass subscriberId to list one subscriber's contracts. | `search`, `mobileNumber`, `simCardNumber`, `imei`, `firstName`, `lastName`, `productName`, `state` enum(ACTIVE,CLOSED,ORDERED,PENDING,BLOCKED), `subscriberId`, `offset`, `limit` | `contracts.list` (filters) or `subscribers.listContracts` when `subscriberId` is set |
| 8 | `kpn_mobile_contracts_get` | R | Get a contract's details (number, SIM/ICCID, IMEI, tariff, status, dates, user). PIN/PUK are always masked; use kpn_mobile_contracts_get_puk for a PUK. | `id`*, `includeItems` bool (default false; add-on/bundle tree) | `contracts.get` → `maskContract` (+ `getItems`) |
| 9 | `kpn_mobile_contracts_get_puk` | S | ⚠ HIGH-IMPACT. Reveal the PUK code of a SIM so a locked phone can be unlocked. PUKs are security-sensitive: verify the requester's identity first (consider kpn_sim_swap_get_date). Confirm with the user before invoking. | `id`*, `confirm_destructive_action` | `contracts.get` → gate → return only `{contractId, phoneNumber, puk}` |
| 10 | `kpn_mobile_contracts_get_operations` | R | Show which actions (block/unblock SIM, replace SIM, modify, move, terminate, port-out…) are currently allowed on a contract and which open orders block them. | `contractId`* | `contracts.getOperations` |
| 11 | `kpn_mobile_orders_list` | R | List KPN business-mobile orders (SIM blocks, replacements, new lines, hardware…) by status. Defaults to open orders. UNAUTHORIZED orders await approval. | `status` array of OrderStatus (default ["NEW","IN_PROGRESS","UNAUTHORIZED"]), `search`, `currentUserOnly` bool, `offset`, `limit` | `orders.list` (`withRequiredActionFirst: true`) |
| 12 | `kpn_mobile_orders_get` | R | Get an order's details: status, dates, items, costs, SIM/eSIM, delivery and which follow-up actions are allowed. | `id`* | `orders.getPretty` (on 404/5xx fall back to `orders.get`); mask any `pin`/`puk` keys |
| 13 | `kpn_mobile_service_requests_list` | R | List KPN business-mobile service requests (changes to existing contracts) by status. Defaults to open ones. | `status` (same default as #11), `search`, `currentUserOnly`, `offset`, `limit` | `serviceRequests.list` |
| 14 | `kpn_mobile_service_requests_get` | R | Get a service request's details (type, status, expected/finish dates, SIM changes, attachments list). | `id`* | `serviceRequests.get` |
| 15 | `kpn_mobile_invoices_list` | R | List KPN business-mobile invoices (number, date, due date, amount, type) for the customer or one debtor, optionally in a date range. | `debtorId` int, `searchFrom`, `searchTo` (YYYY-MM-DD), `offset`, `limit` | `invoices.list`. Amounts: add `totalAmountToPay` in euros next to the cents value. |
| 16 | `kpn_mobile_invoices_get_pdf` | R | Download one invoice as a PDF (returned as an embedded resource). | `id`* | `invoices.downloadPdf` → resource content `kpn://invoices/{id}.pdf`. If > 4 MB, return an isError size message. |
| 17 | `kpn_mobile_hierarchy_list` | R | Browse the customer's KPN organisation tree (customer, debtors, cost centres, groups, locations, subscribers). Omit parentId for the roots. Debtor ids feed kpn_mobile_invoices_list. | `parentId` int, `search`, `offset`, `limit` | `hierarchy.listChildren({ includeCustomer: true, includeGroups: true })` |
| 18 | `kpn_mobile_thresholds_list` | R | List daily usage caps/alerts (national/roaming data MB, voice minutes, roaming €). Pass thresholdId to list the contracts it applies to. | `thresholdId` int, `offset`, `limit` | `thresholds.list` or `thresholds.listContracts` |
| 19 | `kpn_mobile_sim_block` | D | ⚠ HIGH-IMPACT. Block the SIM on a contract (lost/stolen phone): calls, SMS and data stop until unblocked. Creates a KPN order; it may need authorization. Confirm with the user before invoking. | `contractId`*, `referenceNumber`, `confirm_destructive_action` | `getOperations` (blockSim must be enabled; otherwise isError listing blocking orders) → `contracts.get` for the confirm text → gate → `blockSim` |
| 20 | `kpn_mobile_sim_unblock` | D | ⚠ HIGH-IMPACT. Unblock a previously blocked SIM, restoring service. Only do this once the device is confirmed recovered and in the rightful owner's hands. Confirm with the user before invoking. | `contractId`*, `referenceNumber`, `confirm_destructive_action` | `getOperations` (unblockSim enabled) → `get` → gate → `unblockSim` |
| 21 | `kpn_mobile_sim_replace` | D | ⚠ DESTRUCTIVE. Replace the SIM on a contract with a new physical SIM (ICCID) or an eSIM. The current SIM stops working when the order completes. For eSIM an email address for the activation QR code is required. Confirm with the user before invoking. | `contractId`*, `esim` bool*, `newSimCardNumber` (required if !esim), `email` (required if esim), `wishDate` YYYY-MM-DD, `referenceNumber`, `confirm_destructive_action` | `getOperations` (replaceSim enabled) → `validateSimReplacement` (physical SIM only) → `get` → gate → `replaceSim` |
| 22 | `kpn_mobile_orders_authorize` | D | ⚠ HIGH-IMPACT. Approve an order waiting for authorization (status UNAUTHORIZED) so KPN executes it; this may commit the customer to costs. Confirm with the user before invoking. | `orderId`*, `confirm_destructive_action` | `orders.get` (the status must be UNAUTHORIZED, otherwise isError) → gate (message includes type, ordered-for, one-time/recurring cost in €) → `authorize` |
| 23 | `kpn_mobile_orders_cancel` | D | ⚠ DESTRUCTIVE. Cancel an open KPN business-mobile order. It cannot be resumed afterwards. Confirm with the user before invoking. | `orderId`*, `note`, `confirm_destructive_action` | `orders.get` (the `cancelOrder` availability must be enabled when present) → gate → `cancel` |

Handler behaviour for the confirm step:
- The confirmation message always names the concrete target, for example *"Block the SIM of +31612345678 (J. Jansen, contract 123456)?"*.
- A refusal returns `textResult("Cancelled; nothing was changed.")`.
- A blocked result returns `errorResult(gate.message)`.
- A write that succeeds returns the `OrderSummary` plus the note *"KPN processes this asynchronously; track it with kpn_mobile_orders_get {id}. If status is WaitingForAuthorization, an authorised user must approve it (kpn_mobile_orders_authorize)."*

`kpn_disturbances_check` output:
- The categories come back untouched, with HTML stripped from `long_description`.
- It prepends `summary: { total, open, byCategory: {broadband, fixed, mobile, generic} }`.
- Zero items is a **success** with the explicit text *"No known KPN disturbances at this address."*. This is the one deliberate exception to the empty-result rule, because "no outage" is a real answer.
- Address alerts (an unknown address) become `isError`.

`tools.test.ts` asserts the following:
- exactly 23 tools, in the table order;
- every name matches `^kpn_[a-z_]+$`;
- every D and S tool has the prefix, the CONFIRM_ARG property and the literal `destructiveHint: true`. D tools only: S is read-only.
- `TOOLS` is the same reference on each `listToolsResult()` call.

### 4.4 Server file list and ownership

```
kpn-mcp/
  package.json tsconfig.json eslint.config.js vitest.config.ts .releaserc.json .npmrc .gitignore .dockerignore
  Dockerfile server.json README.md CHANGELOG.md CONTRIBUTING.md LICENSE
  .github/workflows/{release.yml,test.yml,mcp-assert.yml}
  scripts/smoke-dual-era.mjs  scripts/lint-destructive-warnings.mjs
  src/entry.ts src/index.ts src/mcp-server.ts src/elicitation.ts src/utils/logger.ts
  src/tools/index.ts            # TOOLS = [...CORE_TOOLS, ...NETWORK_TOOLS, ...MOBILE_READ_TOOLS, ...MOBILE_WRITE_TOOLS]
  src/tools/core.ts             # tool 1
  src/tools/network.ts          # tools 2–4
  src/tools/mobile-read.ts      # tools 5–18
  src/tools/mobile-write.ts     # tools 19–23
  src/handlers/index.ts         # dispatch: merges CORE/NETWORK/MOBILE_READ/MOBILE_WRITE handler maps; describeKpnError
  src/handlers/results.ts src/handlers/paging.ts src/handlers/addresses.ts src/handlers/masking.ts
  src/handlers/core.ts          # kpn_test_connection
  src/handlers/network.ts       # tools 2–4
  src/handlers/mobile-read.ts   # tools 5–18
  src/handlers/mobile-write.ts  # tools 19–23
  src/__tests__/{mcp-server,http-gate,elicitation,elicitation-serving,tools,helpers}.test.ts
  src/__tests__/handlers-network.test.ts  handlers-mobile-read.test.ts  handlers-mobile-write.test.ts
  src/__tests__/stub-client.ts  # stubClient() factory with vi.fn() for every SDK method in §3.4
```

Each domain tools file exports `export const <X>_TOOLS: Tool[]`. Each domain handlers file exports `export const <X>_HANDLERS: Record<string, ToolHandler>`, using the `ToolHandler` type exported from `handlers/results.ts`.

`handlers/index.ts` throws at module load if two maps share a key, or if any `TOOLS` name has no handler.

Environment variables:
- `MCP_TRANSPORT` = stdio | http
- `MCP_HTTP_PORT` (default 8080), `MCP_HTTP_HOST`
- `AUTH_MODE` = gateway | env
- `LOG_LEVEL`
- the `KPN_*` variables from §2.4

The Docker build uses `--platform linux/amd64`.

---

## 5. Gateway vendor-config entry

File: `/Users/asachs/work/wyre/engineering/projects/mcp/mcp-servers/conduit/src/credentials/vendor-config.ts`. Insert the entry alphabetically, after `kaseya-*` and before `liongard`.

```ts
  kpn: {
    name: "KPN",
    slug: "kpn",
    category: "network",
    containerUrl: "http://kpn-mcp",
    fields: [
      { key: "clientId", label: "Client ID", required: true,
        placeholder: "developer.kpn.com → Dashboard → Projects → your project" },
      { key: "clientSecret", label: "Client Secret", required: true, secret: true },
      { key: "msmClientId", label: "Mobile Services Management Client ID (optional)", required: false,
        placeholder: "Only if this customer's KPN Zakelijk MSM app differs from the project above" },
      { key: "msmClientSecret", label: "Mobile Services Management Client Secret (optional)", required: false, secret: true },
    ],
    headerMapping: {
      clientId: "X-KPN-Client-Id",
      clientSecret: "X-KPN-Client-Secret",
      msmClientId: "X-KPN-MSM-Client-Id",
      msmClientSecret: "X-KPN-MSM-Client-Secret",
    },
    docsUrl: "https://developer.kpn.com/",
    credentialDocsUrl: "https://github.com/WYRE-AI/kpn-mcp#credentials",
    async validate(creds) {
      // Minting a client-credentials token is the cheapest authenticated check.
      // It proves the id/secret pair; it does NOT prove product entitlement.
      const mint = async (path: string, id: string, secret: string) =>
        fetch(`https://api-prd.kpn.com${path}?grant_type=client_credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ client_id: id, client_secret: secret }),
          signal: AbortSignal.timeout(10_000),
        });
      if (Boolean(creds.msmClientId) !== Boolean(creds.msmClientSecret)) {
        return { valid: false, error: "Provide both MSM Client ID and MSM Client Secret, or neither." };
      }
      const res = await mint("/oauth/client_credential/accesstoken", creds.clientId, creds.clientSecret);
      if (!res.ok) {
        return { valid: false, error: res.status === 401
          ? "Invalid KPN client ID or secret."
          : `KPN token endpoint returned HTTP ${res.status}.` };
      }
      if (creds.msmClientId) {
        const msm = await mint("/oauth/grip/msm/accesstoken", creds.msmClientId, creds.msmClientSecret);
        if (!msm.ok) {
          return { valid: false, error: msm.status === 401
            ? "Invalid KPN Mobile Services Management client ID or secret."
            : `KPN MSM token endpoint returned HTTP ${msm.status}.` };
        }
      }
      return { valid: true };
    },
  },
```

Follow-ups outside these repos, owned by the integration step: the Bicep/Container App for `kpn-mcp`, and msp-claude-plugins marketplace registration, which uses the msp-plugin-development skill checklist.

---

## 6. Parallel work breakdown (disjoint file ownership)

Each unit owns only the files it lists. Nobody else edits them. Units code against the contracts in §3 and §4, so they do not need each other's code in order to write their own.

- **Wave 1** runs SDK-CORE, SDK-NET, SDK-MOB-ORG, SDK-MOB-ORD and SRV-CORE in parallel. SDK domain units write their tests against `tests/helpers.ts` exactly as specified in §3.5. The SDK builds green once SDK-CORE lands.
- **Wave 2** runs SRV-NET, SRV-MOB-READ, SRV-MOB-WRITE and GW in parallel. Server units depend on the SDK through `"@wyre-ai/node-kpn": "file:../node-kpn"` during development; INTEGRATE swaps it for the published `^1.0.0`. Server domain units can start in wave 1 against `stub-client.ts`, since they only need the SDK types.
- **INTEGRATE** runs last.

| Unit | Repo | Owns (exact) |
|---|---|---|
| **SDK-CORE** | node-kpn | `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `.releaserc.json`, `.npmrc`, `.gitignore`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`, `.github/workflows/release.yml`, `src/{index,config,auth,errors,http,rate-limiter,client,msm}.ts`, `src/types/{index,common}.ts`, `tests/{setup,helpers}.ts`, `tests/mocks/{server,handlers,handlers-oauth}.ts`, `tests/fixtures/oauth.ts`, `tests/{auth,http,errors,msm,rate-limiter,client}.test.ts`. It writes `index.ts`, `client.ts`, `types/index.ts` and `mocks/handlers.ts` **pre-wired** to every domain module name in §3.2, so domain units never touch them. |
| **SDK-NET** | node-kpn | `src/resources/{disturbances,availability,sim-swap}.ts`, `src/types/{disturbance,availability,sim-swap}.ts`, `tests/fixtures/network.ts`, `tests/mocks/handlers-network.ts` (exports `networkHandlers`), `tests/{disturbances,availability,sim-swap}.test.ts` |
| **SDK-MOB-ORG** | node-kpn | `src/resources/mobile-{subscribers,hierarchy,thresholds,invoices}.ts`, `src/types/mobile-{subscriber,hierarchy,threshold,invoice}.ts`, `tests/fixtures/mobile-org.ts`, `tests/mocks/handlers-mobile-org.ts` (exports `mobileOrgHandlers`), `tests/mobile-{subscribers,hierarchy,thresholds,invoices}.test.ts` |
| **SDK-MOB-ORD** | node-kpn | `src/resources/mobile-{contracts,orders,service-requests}.ts`, `src/types/mobile-{contract,order,service-request}.ts`, `tests/fixtures/mobile-orders.ts`, `tests/mocks/handlers-mobile-orders.ts` (exports `mobileOrderHandlers`), `tests/mobile-{contracts,orders,service-requests}.test.ts` |
| **SRV-CORE** | kpn-mcp | All root and config files in §4.4, `.github/workflows/*`, `scripts/*`, `src/{entry,index,mcp-server,elicitation}.ts`, `src/utils/logger.ts`, `src/tools/{index,core}.ts`, `src/handlers/{index,results,paging,addresses,masking,core}.ts`, `src/__tests__/{mcp-server,http-gate,elicitation,elicitation-serving,tools,helpers}.test.ts`, `src/__tests__/stub-client.ts`. It pre-wires `tools/index.ts` and `handlers/index.ts` to the domain exports named in §4.4. |
| **SRV-NET** | kpn-mcp | `src/tools/network.ts`, `src/handlers/network.ts`, `src/__tests__/handlers-network.test.ts` |
| **SRV-MOB-READ** | kpn-mcp | `src/tools/mobile-read.ts`, `src/handlers/mobile-read.ts`, `src/__tests__/handlers-mobile-read.test.ts` |
| **SRV-MOB-WRITE** | kpn-mcp | `src/tools/mobile-write.ts`, `src/handlers/mobile-write.ts`, `src/__tests__/handlers-mobile-write.test.ts` |
| **GW** | conduit | The `kpn` entry in `src/credentials/vendor-config.ts`, and only that entry. The unit must not reformat anything else in the file. It also adds a validate() unit test if a vendor-config test file exists: stub `fetch` and cover the 200, 401 and half-MSM-pair cases. |
| **INTEGRATE** | both | Swap the `file:` dependency for the published version. Then run `npm run build && npm test && npm run lint` in node-kpn, and `npm run build && npm test && npm run lint && node scripts/lint-destructive-warnings.mjs src && npm run smoke` in kpn-mcp. Update both CHANGELOGs (Keep a Changelog) and commit with conventional commits (`feat:`). Handle the deploy and marketplace follow-ups. Nothing is "done" without captured green output. |

Required test coverage per server domain unit:
- For every tool: the happy path; an invalid-argument path; an SDK error mapped to isError; and an empty result → isError. The empty-result case does not apply to `kpn_disturbances_check` (see §4.3).
- For every D and S tool, all four gate outcomes:
  - a form-capable client with no response → `input_required`;
  - an accepted response → the mutation is called exactly once;
  - a declined response → the mutation is not called;
  - no elicitation and no CONFIRM_ARG → blocked, with the mutation not called.
- Pre-condition failures must not call the mutation:
  - an operation not enabled;
  - an order that is not UNAUTHORIZED;
  - an invalid ICCID from the validator.
- Masking: `kpn_mobile_contracts_get` output never contains the fixture's PIN or PUK strings.

---

## 7. Open risks and unknowns

1. **MSM access model is unverified (highest risk).** We do not know whether the `/oauth/grip/msm/accesstoken` realm accepts ordinary self-serve API Store project credentials, or needs a KPN Zakelijk account manager to bind an app to a customer's GRIP user. If only the latter works, the 19 MSM tools work per onboarded customer only. The design already treats MSM credentials as per-customer and optional, and reports MSM token failure separately in `kpn_test_connection`. **Confirm this with api_developer@kpn.com before release.**
2. **No sandbox for MSM, Disturbance or Speed Check.** Test and production share one host, and the tier belongs to the account. Every SDK test is MSW-only. A live smoke test needs a real (free-tier) project, and MSM write tools can only be proven against a real customer. The write tools will ship with only mock coverage and must be announced as such.
3. **Response shapes are inferred from OAS files and docs, not live authenticated calls.**
   - Speed Check disagrees with itself on `bandwidth` vs `max_bandwidth` and on alerts as an object vs an array. The SDK normalizes both.
   - Apigee fault bodies on non-401 statuses are only partly observed.
   - `/track-and-trace/orders/{id}/pretty` has an untyped schema.
4. **The MSM `filters` DSL syntax** (`COL: "a","b"; COL2: "c"`) comes from the spec's prose only. `buildFilters` isolates it, so a correction touches one function.
5. **Entitlement failures look like auth failures.** A token mints even when the product is not in the project, and the call then fails with 401 or 403. Error messages must say so (§2.3); users will otherwise report "bad credentials".
6. **Unpublished quotas.** No numeric rate limits exist, and free-tier caps are small. The server therefore surfaces the `quota-*` headers in `kpn_test_connection`, and a 429 error message includes `quota-reset-UTC`.
7. **SIM Swap pricing and legal basis are unknown.** It may be billable per call, and using it needs a GDPR legal basis; the tool description frames it as a fraud check. Its coverage is KPN NL numbers only: other operators return 404 `SIM_SWAP.UNKNOWN_PHONE_NUMBER`, which the handler reports as "not a KPN mobile number or unknown".
8. **Sensitive data.**
   - ContractDetails carries PIN and PUK, so it is masked everywhere except the gated `get_puk` tool.
   - Invoice PDFs and subscriber details are personal data. Logs must never print tool results or credentials (logger debug logs the tool name only).
9. **No-retry on MSM writes** means a transient 502 surfaces to the user. That is deliberate: a double-submitted block or authorize is worse. The error text tells the user to check `kpn_mobile_orders_list` before retrying.
10. **Asynchronous orders and four-eyes flow.** Block, replace and similar orders may land in `WaitingForAuthorization`, and "success" means an order was *created*, not that the SIM is already blocked. Tool output must say this (§4.3).
11. **Meraki (SD-WAN) is deferred.** Customers on KPN managed SD-WAN get no network tools from this server until `node-meraki` gains baseUrl and token-provider support. Track this as a separate issue in meraki-mcp.
