# kpn-mcp Grexx / IRMA surface

Default tool surface as of 2026-10-07. The developer.kpn.com design in `DESIGN.md` still describes the legacy tools, which are off unless `KPN_LEGACY_DEVELOPER_API=1`.

## Auth

Acceptatie (Grexx #4029, confirmed live 2026-10-07) is **OAuth 2.0 client credentials**, then `Authorization: Bearer` on `POST /realtime`. Basic Auth on `POST /realtime` returns `403 Auth method Basic not allowed` and is not a fallback for that call. Caching (until 60 seconds before `expires_in`) and the single 401 remint live in `@wyre-ai/node-kpn` `^2.1.0`. This server hands token minting to `GrexxClient`, which sends HTTP Basic first and may fall back to form-body `client_id` / `client_secret` after HTTP 400/401 `invalid_client`. kpn-mcp only passes the username, password, and env URLs into that client.

| Env (env mode) | Gateway header (`AUTH_MODE=gateway`) | Required |
|---|---|---|
| `KPN_GREXX_USERNAME` | `X-KPN-Grexx-Username` | yes |
| `KPN_GREXX_PASSWORD` | `X-KPN-Grexx-Password` | yes |
| `KPN_GREXX_BASE_URL` | none | yes. Interface root, no trailing `/realtime`, no default |
| `KPN_GREXX_TOKEN_URL` | none | no. Default `https://service-accept.grexx.today/oauth/access_token` |

Gateway mode never reads the username or password from the environment, and never reads a base URL or token URL from a header. `X-KPN-Grexx-Base-Url`, `X-KPN-Grexx-Token-Url`, and the older `X-KPN-Base-Url` / `X-KPN-Token-Url` names are rejected with HTTP 400 before the MCP handler runs.

A request missing either Grexx credential header is HTTP 401 JSON-RPC `-32001`. It does not fall through to env credentials.

## SDK

Phase-1 tools import the Grexx client from the package root (`GrexxClient`, `zipCodeCheck`, `ZIP_CODE_PORTFOLIOS`, `ZIP_CODE_SUPPLIERS`, `prequalification`, `PREQUALIFICATION_PRODUCT_TYPES`, `PREQUALIFICATION_SUPPLIERS`, `orderData`). They do not import `@wyre-ai/node-kpn/legacy`.

The dependency is `"@wyre-ai/node-kpn": "^2.1.0"`, published from
[node-kpn#5](https://github.com/WYRE-AI/node-kpn/pull/5) (tag `v2.1.0`).
Token minting is the `^2.0.1` behavior from
[node-kpn#4](https://github.com/WYRE-AI/node-kpn/pull/4).
Legacy tools keep importing `KpnClient` from `@wyre-ai/node-kpn/legacy`.

## Tools (15)

| Tool | IRMA request | SDK |
|---|---|---|
| `kpn_grexx_test_connection` | `ZipCodeCheckRequest_V6` probe, portfolio All, 1012JS / 1, `IsRoomNumberKnown=false` | `GrexxClient.zipCodeCheck` |
| `kpn_grexx_zipcode_check` | `ZipCodeCheckRequest_V6` | `zipCodeCheck` / `buildZipCodeCheckRequest` |
| `kpn_grexx_prequalification` | `PrequalificationRequest_V2` | `prequalification` / `buildPrequalificationRequest` |
| `kpn_grexx_order_data` | `OrderDataRequest_V1` | `orderData` / `buildOrderDataRequest` |

`kpn_grexx_test_connection` proves the token endpoint and `POST /realtime`. The probe address is the public reference used in the acceptatie smoke. It does not read a customer record. The tool result does not include raw XML.

`kpn_grexx_zipcode_check` arguments are the SDK's `ZipCodeCheckInput` (`portfolio`, `zipCode`, `houseNumber`, `houseNumberExtension`, `serviceId`, `roomNumber`, `isRoomNumberKnown`, `suppliers`). Portfolio and supplier enums are the SDK constants, not a second list.

`kpn_grexx_prequalification` arguments are the SDK's `PrequalificationInput` (`zipCode`, `houseNumber`, `houseNumberExtension`, `roomNumber`, `hasBroadband`, `hasPhone`, `orderId`, `phoneNumber`, `productTypeCode`, `referencePhoneNumber`, `serviceId`, `suppliers`, `israSpecs`, `isComplexAddress`). Product-type and supplier enums are `PREQUALIFICATION_PRODUCT_TYPES` and `PREQUALIFICATION_SUPPLIERS`, not a second list. When `hasBroadband` is true, `serviceId` or `referencePhoneNumber` is required. The result is the parsed address plus products and their availability. It does not include raw XML. `ErrorClass` and `ErrorMessage` are returned on that result.

`kpn_grexx_order_data` takes the SDK's `OrderDataInput` (`orderId`, an `xs:int`). The result is `Status` plus, when present, `customerId`, `productCode`, and `quantity`. It does not include raw XML.

These four tools are reads. Realtime retries (network, HTTP 429 / code 108, 5xx) stay inside the SDK.

### XSD-spec tools (11)

Calls without a node-kpn builder are specs in `src/tools/grexx-realtime.ts`: field names, order, types, limits and enums copied from the request XSDs in the portal (API Toolmodule → Webservice Beschrijvingen, export 2026-10-05). One handler (`src/handlers/grexx-realtime.ts`) validates arguments, emits the body in XSD order and posts it with `GrexxClient.postRealtime`. **IRMA enforces `xs:sequence` order**: an element out of place is a 109.

| Tool | IRMA request | Notes |
|---|---|---|
| `kpn_grexx_carrier_info` | `CarrierInfoRequest_V1` | acceptatie stub address 9999ZZ 1 |
| `kpn_grexx_radius_check` | `RadiusCheckRequest_V1` | PPP `Password` masked |
| `kpn_grexx_ras_check` | `RasCheckRequest_V1` | |
| `kpn_grexx_start_line_diagnose` | `StartLineDiagnoseRequest_V1` | starts a test at KPN: not read-only, never retried; GetLatest is not exposed |
| `kpn_grexx_customer_data` | `CustomerDataRequest_V1` | take ≤ 100 |
| `kpn_grexx_order_summary` | `OrderSummaryRequest_V1` | take ≤ 2500; dates need a time |
| `kpn_grexx_get_sim` | `GetSimRequest_V1` | `Puc1`, eSIM `ActivationCode`/`ConfirmationCode` masked |
| `kpn_grexx_mobile_settings` | `GetMobileSettingsRequest_V1` | |
| `kpn_grexx_mobile_usage` | `GetMobileSubscriptionUsageRequest_V1` | |
| `kpn_grexx_mobile_orders` | `GetMobileSubscriptionOrdersRequest_V1` | 1-50 ids; one bad id fails the batch; SIM codes masked |
| `kpn_grexx_available_portings` | `AvailablePortingsRequest_V1` | exactly one of customerId / hipGroupOrderId |

Results are JSON: `request`, `response`, `code`, `messages`, `requestId`, `httpStatus`, `data` (the response document without `Status`), and `secretsMasked: true` when anything was masked. Lists come back as parsed: one element is an object, several are an array.

### Error shapes (seen live 2026-10-09)

- **`NinaResponse`, HTTP 200.** `<NinaResponse><IsSuccess>false</IsSuccess><ErrorCode>…</ErrorCode>…`: seen for 105 (unknown message type), 107 (message type not allowed), 109 (XSD validation) and 68 (unknown error). It has no `Status`, so node-kpn 2.1.0 returns it as success; the handler maps it with `parseGrexxError` (102 forbidden, 108 rate limit). A builder tool reports it as an unexpected root; `describeGrexxError` decodes it.
- **`Status/Code` `ValidationError` or `UnknownError`** on the normal response root: node-kpn throws a typed `GrexxError`.
- **Root `ErrorMessage`** on responses without `Status` (CustomerData, CarrierInfo, Prequalification, RadiusCheck, RasCheck, GetMobileSettings): `isError` with the message and the data.

Error text never includes a raw response body: node-kpn uses the body as the message when Grexx sends an error without one, and that body can hold SIM codes.

### Live acceptatie (2026-10-09)

The ten reads passed IRMA XSD validation. Returned data: customer_data, order_summary, ras_check and radius_check (FTTH order 11640032), mobile_orders, available_portings, carrier_info (9999ZZ 1). IRMA errors from the shared acceptatie data: get_sim (no active SIM on any test order), mobile_settings ("Unexpected error."), mobile_usage (NinaResponse 68). start_line_diagnose was not sent.

## Not registered

Queued calls, OrderModule, and Proxymodule notifications are out of scope: their results arrive asynchronously on a partner-hosted endpoint.

## Legacy surface

`KPN_LEGACY_DEVELOPER_API=1` appends the 23 developer.kpn.com tools after the Grexx tools. That flag is read when the process starts. Legacy tools import `KpnClient` from `@wyre-ai/node-kpn/legacy` and still use `KPN_CLIENT_ID` / `KPN_CLIENT_SECRET` (and the optional MSM pair). With the flag off, those names are unknown on `tools/call`.

## Serving

Unchanged fleet shape: stdio and HTTP `:8080/mcp`, `createMcpHandler({ legacy: 'stateless' })`, shallow `/health` (no upstream call), optional `X-Gateway-S2S`. CORS allows `X-KPN-Grexx-Username` and `X-KPN-Grexx-Password`. It does not allow URL headers.
