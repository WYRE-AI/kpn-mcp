# kpn-mcp

MCP server for KPN IRMA APIs hosted by Grexx (acceptatie: `service-accept.grexx.today`), aimed at MSP helpdesks. The default surface is realtime XML over OAuth 2.0 client credentials. The SDK sends HTTP Basic to the token endpoint. `POST /realtime` uses the Bearer token.

Built on the MCP **2026-07-28** spec via the split v2 SDK
(`@modelcontextprotocol/server` / `/node` / `/client` `^2.0.0-beta.5`) with **dual-era
serving**: one shared `McpServerFactory` behind `createMcpHandler({ legacy: 'stateless' })`
answers both 2025-era `initialize`-handshake clients and modern 2026-07-28 envelope clients,
with the same tool list for every caller. Ships as a GHCR container only (no MCPB bundle).
The client is [`@wyre-ai/node-kpn`](https://github.com/WYRE-AI/node-kpn) (Grexx export).
Contract: [`docs/GREXX.md`](docs/GREXX.md).

## Tools (2, flat)

- `kpn_grexx_test_connection`: the SDK mints an OAuth client-credentials token and posts a
  `ZipCodeCheckRequest_V6` probe for the public reference address 1012JS 1 (portfolio All).
  Success means the token endpoint and `POST /realtime` accepted the Bearer token.
- `kpn_grexx_zipcode_check`: technology and speeds at a Dutch address
  (`ZipCodeCheckRequest_V6` → `ZipCodeCheckResponse_V5`).

Further realtime tools (prequalification, carrier info, line diagnose, customer and order
reads, mobile reads) wait until `@wyre-ai/node-kpn` ships their XSD builders. This server
does not invent those fields. Queued writes and Proxymodule notifications are not exposed.

Set `KPN_LEGACY_DEVELOPER_API=1` to also serve the previous 23 developer.kpn.com tools
(disturbances, availability, SIM swap, MSM). They are absent from the default list.
See `docs/DESIGN.md` for that catalog. Gated MSM writes still require confirmation.

## Credentials

Grexx username and password are the OAuth `client_id` and `client_secret` (`scope=all`).
Copy the interface root from the partner portal (**API Gegevens**). There is no default
base URL: acceptatie and production differ.

| Env var (env mode) | Gateway header (`AUTH_MODE=gateway`) | Required |
|---|---|---|
| `KPN_GREXX_USERNAME` | `X-KPN-Grexx-Username` | yes |
| `KPN_GREXX_PASSWORD` | `X-KPN-Grexx-Password` | yes |
| `KPN_GREXX_BASE_URL` | none | yes. Interface root, without `/realtime` |
| `KPN_GREXX_TOKEN_URL` | none | no. Default `https://service-accept.grexx.today/oauth/access_token` |

Example (acceptatie shape — replace the interface id from API Gegevens):

```bash
export KPN_GREXX_USERNAME="..."
export KPN_GREXX_PASSWORD="..."
export KPN_GREXX_BASE_URL="https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/<interface-id>/"
# export KPN_GREXX_TOKEN_URL="https://service-accept.grexx.today/oauth/access_token"
```

See [`env.example`](env.example). Token mint, cache, and Bearer retry live in
`@wyre-ai/node-kpn`. A header-supplied base URL or token URL is rejected (HTTP 400):
it would send the client secret or Bearer token to a caller-chosen host.

In gateway mode a request missing `X-KPN-Grexx-Username` or `X-KPN-Grexx-Password` is
answered `401` (JSON-RPC error `-32001`) before the MCP handler runs. It never falls
through to env credentials. The gateway does not send the base URL.

When `CONDUIT_S2S_SECRET` is set, every request except `/health` must also carry a valid
`X-Gateway-S2S` HMAC header, or it is answered `401`. Unset, the check is off.

## SDK dependency

Import the Grexx client from `@wyre-ai/node-kpn` (package root), not `/legacy`.

The dependency is the published range `^2.0.1` (Grexx token HTTP Basic from
[node-kpn#4](https://github.com/WYRE-AI/node-kpn/pull/4), tag `v2.0.1`). `/legacy`
remains the developer.kpn.com client for `KPN_LEGACY_DEVELOPER_API=1` only.
This server does not mint the Grexx token.

## Running

```bash
export NODE_AUTH_TOKEN=$(gh auth token)   # GitHub Packages auth for @wyre-ai/*
npm install
npm run build
node dist/index.js                        # stdio (default)
MCP_TRANSPORT=http node dist/index.js     # HTTP on :8080 (/mcp, /health)
npm run smoke                             # both protocol eras serve the same Grexx tools
```

Docker (linux/amd64 per fleet law):

```bash
docker build --platform linux/amd64 --build-arg GITHUB_TOKEN=$(gh auth token) -t kpn-mcp .
docker run -p 8080:8080 \
  -e KPN_GREXX_USERNAME=... \
  -e KPN_GREXX_PASSWORD=... \
  -e KPN_GREXX_BASE_URL=... \
  kpn-mcp
```

`/health` is a shallow liveness probe. It does not call Grexx.

## Legacy developer.kpn.com tools

With `KPN_LEGACY_DEVELOPER_API=1` the process also registers `kpn_test_connection`,
`kpn_disturbances_check`, `kpn_availability_check`, `kpn_sim_swap_get_date`, and the MSM
read/write tools. Credentials are `KPN_CLIENT_ID` / `KPN_CLIENT_SECRET` (gateway:
`X-KPN-Client-Id` / `X-KPN-Client-Secret`), plus an optional MSM pair. `KPN_BASE_URL`
stays env-only. A half MSM pair is rejected. MSM writes still create orders, are not
retried, and require confirmation (`confirm_destructive_action` when the client cannot
be prompted).

## Vendor quirks encoded here

- OAuth client_credentials, `scope=all`. The SDK sends HTTP Basic to the token endpoint, then Bearer on `POST /realtime` (`Content-Type: text/xml`).
  Plain XML, no SOAP envelope. Basic Auth is not sent on `POST /realtime`.
- This server does not mint the token and does not post `client_id` or `client_secret` in a form body.
- The token endpoint is not retried into a Bearer-less call. HTTP 401 remints once inside the SDK.
- IRMA code `108` and HTTP 429 are rate limits. Code `102` is an IP allowlist rejection.
- Success codes include `Success` (what acceptatie returned for ZipCodeCheck).

## License

Apache-2.0 © WYRE Technology
