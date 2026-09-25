# kpn-mcp

MCP server for [KPN](https://developer.kpn.com/) APIs, aimed at MSP helpdesks supporting Dutch
customers on KPN: network outage checks, address availability, SIM-swap fraud checks, and
KPN Zakelijk business mobile (Mobile Services Management, MSM v11).

Built on the MCP **2026-07-28** spec via the split v2 SDK
(`@modelcontextprotocol/server` / `/node` / `/client` `^2.0.0-beta.5`) with **dual-era
serving**: one shared `McpServerFactory` behind `createMcpHandler({ legacy: 'stateless' })`
answers both 2025-era `initialize`-handshake clients (the WYRE gateway today) and modern
2026-07-28 envelope clients, with an identical, deterministic 23-tool surface for every
caller. Ships as a GHCR container only (no MCPB bundle). The KPN client is
[`@wyre-ai/node-kpn`](https://github.com/WYRE-AI/node-kpn).

## Tools (23, flat)

Network (free, self-serve products):

- `kpn_test_connection`: mint OAuth tokens, report the account tier, MSM status and quota.
- `kpn_disturbances_check`: current and planned outages at a Dutch address.
- `kpn_availability_check`: fibre/copper availability and speeds at a Dutch address.
- `kpn_sim_swap_get_date`: the most recent SIM swap on a KPN mobile number.

Business mobile (MSM), reads: `kpn_mobile_subscribers_list`, `kpn_mobile_subscribers_get`,
`kpn_mobile_contracts_list`, `kpn_mobile_contracts_get` (PIN/PUK always masked),
`kpn_mobile_contracts_get_operations`, `kpn_mobile_orders_list`, `kpn_mobile_orders_get`,
`kpn_mobile_service_requests_list`, `kpn_mobile_service_requests_get`,
`kpn_mobile_invoices_list`, `kpn_mobile_invoices_get_pdf`, `kpn_mobile_hierarchy_list`,
`kpn_mobile_thresholds_list`.

Gated behind confirmation: `kpn_mobile_contracts_get_puk` (⚠ HIGH-IMPACT sensitive read),
`kpn_mobile_sim_block`, `kpn_mobile_sim_unblock`, `kpn_mobile_orders_authorize`
(⚠ HIGH-IMPACT), `kpn_mobile_sim_replace` and `kpn_mobile_orders_cancel` (⚠ DESTRUCTIVE).

MSM writes create KPN **orders** that are processed asynchronously and may need
authorization. A successful call means the order was created, not that the SIM is already
blocked. They are never retried automatically; after a transient error, check
`kpn_mobile_orders_list` before trying again.

## Credentials

Credentials belong to a KPN API Store **project** (developer.kpn.com → Dashboard →
Projects). Each product (Disturbance Check, Internet Speed Check, SIM Swap, MSM) must be
added to that project; a token still mints when a product is missing, and the call then
fails with 401/403.

| Env var (env mode) | Gateway header (`AUTH_MODE=gateway`) | Required |
|---|---|---|
| `KPN_CLIENT_ID` | `X-KPN-Client-Id` | yes |
| `KPN_CLIENT_SECRET` | `X-KPN-Client-Secret` | yes |
| `KPN_MSM_CLIENT_ID` | `X-KPN-MSM-Client-Id` | no; falls back to the main pair |
| `KPN_MSM_CLIENT_SECRET` | `X-KPN-MSM-Client-Secret` | only together with the MSM id |
| `KPN_BASE_URL` | none (deliberately) | no; default `https://api-prd.kpn.com` |

MSM access is **per end customer**: the MSM token is bound to one customer's GRIP user, so
one gateway connection is one KPN business customer. `KPN_BASE_URL` is env-mode only; a
header-controlled base URL would let a caller redirect client secrets to any host.

In gateway mode a request missing `X-KPN-Client-Id` / `X-KPN-Client-Secret`, or carrying
only half of the MSM pair, is answered `401` (JSON-RPC error `-32001`) before the MCP
handler runs. It never falls through to env credentials.

## Running

```bash
export NODE_AUTH_TOKEN=$(gh auth token)   # GitHub Packages auth for @wyre-ai/*
npm install
npm run build
node dist/index.js                        # stdio (default)
MCP_TRANSPORT=http node dist/index.js     # HTTP on :8080 (/mcp, /health)
npm run smoke                             # proves both protocol eras serve the same tools
```

> **Local-dev note:** during the initial build `@wyre-ai/node-kpn` is a
> `file:../node-kpn` dependency (a sibling checkout, built with `npm run build`). It is
> swapped for the published `^1.0.0` before release; the Docker build needs the published
> package.

Docker (linux/amd64 per fleet law):

```bash
docker build --platform linux/amd64 --build-arg GITHUB_TOKEN=$(gh auth token) -t kpn-mcp .
docker run -p 8080:8080 -e KPN_CLIENT_ID=... -e KPN_CLIENT_SECRET=... kpn-mcp
```

## Elicitation and destructive-action consent

Every gated tool asks before acting, naming the concrete target (for example the phone
number, subscriber and contract for a SIM block). Elicitation rides the SDK v2 MRTR seam:
handlers return `input_required` results that 2026-07-28 clients fulfil and retry, and that
the SDK's legacy shim fulfils server-side for 2025-era stateful connections (stdio). All
reads and the confirmation happen before the single mutating KPN call, so a retried request
cannot duplicate an order.

Callers that cannot be prompted (including stateless legacy HTTP requests, which is how the
WYRE Conduit gateway connects) fail closed: the gated tools refuse to run unless the call
passes `"confirm_destructive_action": true`. That argument is consulted only when no prompt
is possible and never skips a confirmation an interactive user would have seen.

## Vendor quirks encoded here

- Two OAuth realms on one host: `gateway` for the network products and SIM Swap, `msm` for
  business mobile. Tokens are Apigee client-credentials tokens whose values are all strings.
- Test and production share one host and keys; the tier (`demo`/`prod`) lives on the account.
- Entitlement failures look like auth failures (401/403); error messages say so.
- No published rate limits; `kpn_test_connection` surfaces the `quota-*` headers.
- ContractDetails carries the SIM's PIN and PUK in clear text; the server masks them
  everywhere except the gated `kpn_mobile_contracts_get_puk`.

## License

Apache-2.0 © WYRE Technology
