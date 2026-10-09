# kpn-mcp Grexx / IRMA surface

Default tool surface as of 2026-10-07. The developer.kpn.com design in `DESIGN.md` still describes the legacy tools, which are off unless `KPN_LEGACY_DEVELOPER_API=1`.

## Auth

Acceptatie (Grexx #4029, confirmed live 2026-10-07) is **OAuth 2.0 client credentials**, then `Authorization: Bearer` on `POST /realtime`. Basic Auth on `POST /realtime` returns `403 Auth method Basic not allowed` and is not a fallback for that call. Caching (until 60 seconds before `expires_in`) and the single 401 remint live in `@wyre-ai/node-kpn` `^2.0.1`. This server hands token minting to `GrexxClient`, which sends HTTP Basic first and may fall back to form-body `client_id` / `client_secret` after HTTP 400/401 `invalid_client`. kpn-mcp only passes the username, password, and env URLs into that client.

| Env (env mode) | Gateway header (`AUTH_MODE=gateway`) | Required |
|---|---|---|
| `KPN_GREXX_USERNAME` | `X-KPN-Grexx-Username` | yes |
| `KPN_GREXX_PASSWORD` | `X-KPN-Grexx-Password` | yes |
| `KPN_GREXX_BASE_URL` | none | yes. Interface root, no trailing `/realtime`, no default |
| `KPN_GREXX_TOKEN_URL` | none | no. Default `https://service-accept.grexx.today/oauth/access_token` |

Gateway mode never reads the username or password from the environment, and never reads a base URL or token URL from a header. `X-KPN-Grexx-Base-Url`, `X-KPN-Grexx-Token-Url`, and the older `X-KPN-Base-Url` / `X-KPN-Token-Url` names are rejected with HTTP 400 before the MCP handler runs.

A request missing either Grexx credential header is HTTP 401 JSON-RPC `-32001`. It does not fall through to env credentials.

## SDK

Phase-1 tools import the Grexx client from the package root (`GrexxClient`, `zipCodeCheck`, `ZIP_CODE_PORTFOLIOS`, `ZIP_CODE_SUPPLIERS`). They do not import `@wyre-ai/node-kpn/legacy`.

The dependency is `"@wyre-ai/node-kpn": "^2.0.1"`, published from
[node-kpn#4](https://github.com/WYRE-AI/node-kpn/pull/4) (tag `v2.0.1`).
Legacy tools keep importing `KpnClient` from `@wyre-ai/node-kpn/legacy`.

## Tools (2)

| Tool | IRMA request | SDK |
|---|---|---|
| `kpn_grexx_test_connection` | `ZipCodeCheckRequest_V6` probe, portfolio All, 1012JS / 1, `IsRoomNumberKnown=false` | `GrexxClient.zipCodeCheck` |
| `kpn_grexx_zipcode_check` | `ZipCodeCheckRequest_V6` | `zipCodeCheck` / `buildZipCodeCheckRequest` |

`kpn_grexx_test_connection` proves the token endpoint and `POST /realtime`. The probe address is the public reference used in the acceptatie smoke. It does not read a customer record. The tool result does not include raw XML.

`kpn_grexx_zipcode_check` arguments are the SDK's `ZipCodeCheckInput` (`portfolio`, `zipCode`, `houseNumber`, `houseNumberExtension`, `serviceId`, `roomNumber`, `isRoomNumberKnown`, `suppliers`). Portfolio and supplier enums are the SDK constants, not a second list.

Both tools are reads. Realtime retries (network, HTTP 429 / code 108, 5xx) stay inside the SDK.

## Not registered yet

These Phase-1 names from the tool proposal have **no XSD builder** in node-kpn yet. This server does not invent their fields, and it does not expose a generic XML tool:

`kpn_grexx_prequalification`, `kpn_grexx_carrier_info`, `kpn_grexx_radius_check`, `kpn_grexx_ras_check`, `kpn_grexx_start_line_diagnose`, `kpn_grexx_customer_data`, `kpn_grexx_order_summary`, `kpn_grexx_order_data`, `kpn_grexx_get_sim`, `kpn_grexx_mobile_settings`, `kpn_grexx_mobile_usage`, `kpn_grexx_mobile_orders`, `kpn_grexx_available_portings`.

Queued calls, OrderModule, and Proxymodule notifications are out of scope. PIN/PUK masking does not apply until a GetSim builder exists.

## Legacy surface

`KPN_LEGACY_DEVELOPER_API=1` appends the 23 developer.kpn.com tools after the Grexx tools. That flag is read when the process starts. Legacy tools import `KpnClient` from `@wyre-ai/node-kpn/legacy` and still use `KPN_CLIENT_ID` / `KPN_CLIENT_SECRET` (and the optional MSM pair). With the flag off, those names are unknown on `tools/call`.

## Serving

Unchanged fleet shape: stdio and HTTP `:8080/mcp`, `createMcpHandler({ legacy: 'stateless' })`, shallow `/health` (no upstream call), optional `X-Gateway-S2S`. CORS allows `X-KPN-Grexx-Username` and `X-KPN-Grexx-Password`. It does not allow URL headers.
