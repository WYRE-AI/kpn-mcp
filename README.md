# kpn-mcp

MCP server for KPN IRMA APIs hosted by Grexx (acceptatie: `service-accept.grexx.today`), aimed at MSP helpdesks. The default surface is realtime XML over OAuth 2.0 client credentials. The SDK sends HTTP Basic to the token endpoint. `POST /realtime` uses the Bearer token.

Built on the MCP **2026-07-28** spec via the split v2 SDK
(`@modelcontextprotocol/server` / `/node` / `/client` `^2.0.0-beta.5`) with **dual-era
serving**: one shared `McpServerFactory` behind `createMcpHandler({ legacy: 'stateless' })`
answers both 2025-era `initialize`-handshake clients and modern 2026-07-28 envelope clients,
with the same tool list for every caller. Ships as a GHCR container only (no MCPB bundle).
The client is [`@wyre-ai/node-kpn`](https://github.com/WYRE-AI/node-kpn) (Grexx export).
Contract: [`docs/GREXX.md`](docs/GREXX.md).

## Tools (15, flat)

- `kpn_grexx_test_connection`: the SDK mints an OAuth client-credentials token and posts a
  `ZipCodeCheckRequest_V6` probe for the public reference address 1012JS 1 (portfolio All).
  Success means the token endpoint and `POST /realtime` accepted the Bearer token.
- `kpn_grexx_zipcode_check`: technology and speeds at a Dutch address
  (`ZipCodeCheckRequest_V6` → `ZipCodeCheckResponse_V5`).
- `kpn_grexx_prequalification`: address and product-type availability per supplier
  (`PrequalificationRequest_V2` → `PrequalificationResponse_V1`). When `hasBroadband`
  is true, `serviceId` or `referencePhoneNumber` is required.
- `kpn_grexx_order_data`: customer id, product code, and quantity for an order id
  (`OrderDataRequest_V1` → `OrderDataResponse_V1`).

- 11 more realtime tools built from the portal request XSDs (see `docs/GREXX.md`):
  `kpn_grexx_carrier_info`, `kpn_grexx_radius_check`, `kpn_grexx_ras_check`,
  `kpn_grexx_start_line_diagnose`, `kpn_grexx_customer_data`, `kpn_grexx_order_summary`,
  `kpn_grexx_get_sim`, `kpn_grexx_mobile_settings`, `kpn_grexx_mobile_usage`,
  `kpn_grexx_mobile_orders`, `kpn_grexx_available_portings`. `start_line_diagnose` starts
  a test at KPN, so it is not read-only and is never retried. SIM codes and the
  RadiusCheck PPP password are masked.

IRMA enforces XSD element order and rejects a bad request with an HTTP 200
`NinaResponse`; both are handled by the server. Queued writes and Proxymodule
notifications are not exposed.

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

### HTTP authentication

`CONDUIT_S2S_SECRET` is required when `MCP_TRANSPORT=http`. If it is empty, the process
logs an error and exits non-zero. It never prints the secret. Known placeholders
(`changeme`, `change-me`, `secret`, `placeholder`, `example`, `your-secret`,
`your-s2s-secret`, `s2s-secret`, `replace-me`, `replace-with-a-real-secret`) are
rejected the same way, including when `MCP_ALLOW_INSECURE_DEV=1` is set.

`MCP_ALLOW_INSECURE_DEV=1` is local development only. The process logs a warning,
does not check `X-Gateway-S2S`, and listens on `127.0.0.1` only. A non-loopback
`MCP_HTTP_HOST` (including `0.0.0.0`) is ignored in that mode and the override is logged.

`MCP_HTTP_HOST` is honored when a real secret is set. Unset, that bind stays `0.0.0.0`.
Set `127.0.0.1` to keep a secret-backed process on loopback. The container image sets
`0.0.0.0` and `AUTH_MODE=gateway`.

With a real secret, every request except `/health` and `/healthz` must include:

```
X-Gateway-S2S: t=<unix seconds>,v1=<hex hmac-sha256>
```

`v1` is HMAC-SHA256 of the exact string `t=<unix seconds>` (the same `t=` prefix that
starts the header), keyed with `CONDUIT_S2S_SECRET`, hex-encoded. The timestamp must
be within 300 seconds of the server clock. A missing or invalid header is `401`.
`/health` and `/healthz` stay unauthenticated and do not read credentials. The stdio
transport does not use `CONDUIT_S2S_SECRET`.

```bash
# sign "t=$NOW" with the gateway-provisioned secret
NOW=$(date +%s)
SIG=$(printf 't=%s' "$NOW" | openssl dgst -sha256 -hmac "$CONDUIT_S2S_SECRET" | awk '{print $NF}')
curl -sS -D- http://127.0.0.1:8080/mcp \
  -H "X-Gateway-S2S: t=${NOW},v1=${SIG}" \
  -H "X-KPN-Grexx-Username: ..." \
  -H "X-KPN-Grexx-Password: ..." \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## SDK dependency

Import the Grexx client from `@wyre-ai/node-kpn` (package root), not `/legacy`.

The dependency is the published range `^2.1.0` (Prequalification and OrderData from
[node-kpn#5](https://github.com/WYRE-AI/node-kpn/pull/5), tag `v2.1.0`). Token minting
is the HTTP Basic behavior from
[node-kpn#4](https://github.com/WYRE-AI/node-kpn/pull/4). `/legacy`
remains the developer.kpn.com client for `KPN_LEGACY_DEVELOPER_API=1` only.
This server does not mint the Grexx token.

## Running

```bash
export NODE_AUTH_TOKEN=$(gh auth token)   # GitHub Packages auth for @wyre-ai/*
npm install
npm run build
node dist/index.js                        # stdio (default)
# HTTP refuses to start until CONDUIT_S2S_SECRET is a real secret
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" MCP_TRANSPORT=http node dist/index.js
# Local HTTP only, without a service-to-service secret (always binds 127.0.0.1)
MCP_ALLOW_INSECURE_DEV=1 MCP_TRANSPORT=http node dist/index.js
npm run smoke                             # both protocol eras serve the same Grexx tools
```

Docker (linux/amd64 per fleet law). The image listens on `0.0.0.0` inside the
container and defaults to `AUTH_MODE=gateway`. Publish the port on loopback and
pass the S2S secret. Grexx username and password arrive on each request as
headers. `KPN_GREXX_BASE_URL` stays in the environment because a caller-supplied
URL is rejected.

```bash
docker build --platform linux/amd64 --build-arg GITHUB_TOKEN=$(gh auth token) -t kpn-mcp .
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -e KPN_GREXX_BASE_URL="https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/<interface-id>/" \
  -p 127.0.0.1:8080:8080 \
  kpn-mcp
```

Compose refuses to start when `CONDUIT_S2S_SECRET` is unset, publishes
`127.0.0.1:8080:8080`, and does not inject `KPN_GREXX_USERNAME` or
`KPN_GREXX_PASSWORD`:

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
KPN_GREXX_BASE_URL="https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/<interface-id>/" \
GITHUB_TOKEN=$(gh auth token) \
docker compose up --build
```

Single-tenant HTTP (`AUTH_MODE=env`) still requires the S2S secret, then uses
`KPN_GREXX_USERNAME` and `KPN_GREXX_PASSWORD`:

```bash
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -e AUTH_MODE=env \
  -e KPN_GREXX_USERNAME=... \
  -e KPN_GREXX_PASSWORD=... \
  -e KPN_GREXX_BASE_URL=... \
  -p 127.0.0.1:8080:8080 \
  kpn-mcp
```

`/health` is a shallow liveness probe. It does not call Grexx and does not read credentials.

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
- This server hands token minting to `GrexxClient`, which sends HTTP Basic first and may fall back to form-body `client_id` / `client_secret` after HTTP 400/401 `invalid_client`.
- The token endpoint is not retried into a Bearer-less call. HTTP 401 remints once inside the SDK.
- IRMA code `108` and HTTP 429 are rate limits. Code `102` is an IP allowlist rejection.
- Success codes include `Success` (what acceptatie returned for ZipCodeCheck).

## License

Apache-2.0 © WYRE Technology
