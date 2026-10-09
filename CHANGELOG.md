# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are cut by semantic-release from Conventional Commits.

## [Unreleased]

### Added

- 11 Grexx IRMA realtime tools built from the portal request XSDs: `kpn_grexx_carrier_info`,
  `kpn_grexx_radius_check`, `kpn_grexx_ras_check`, `kpn_grexx_start_line_diagnose`,
  `kpn_grexx_customer_data`, `kpn_grexx_order_summary`, `kpn_grexx_get_sim`,
  `kpn_grexx_mobile_settings`, `kpn_grexx_mobile_usage`, `kpn_grexx_mobile_orders` and
  `kpn_grexx_available_portings`. Requests are sent in XSD element order (IRMA rejects any
  other order with 109). The ten reads passed IRMA XSD validation on acceptatie;
  `start_line_diagnose` starts a real test, so it was not sent.
- Grexx `NinaResponse` rejections (HTTP 200, `IsSuccess=false`) and a filled root
  `ErrorMessage` are tool errors, and `NinaResponse` 102/108 get the usual IP and
  rate-limit hints. SIM PUK (`Puc1`), eSIM activation/confirmation codes and the
  RadiusCheck PPP password are masked, and Grexx error text never includes a raw
  response body.
- `kpn_grexx_prequalification`: address and product-type availability per supplier
  through Grexx `PrequalificationRequest_V2`. When `hasBroadband` is true,
  `serviceId` or `referencePhoneNumber` is required.
- `kpn_grexx_order_data`: customer id, product code, and quantity for an IRMA
  order id through `OrderDataRequest_V1`.
- `kpn_grexx_test_connection`: verify OAuth and realtime access with a zipcode probe
  of public reference address 1012JS 1.
- `kpn_grexx_zipcode_check`: look up address technology and speeds through Grexx IRMA.
- Initial KPN MCP server: flat 23-tool surface over `@wyre-ai/node-kpn` covering
  Disturbance Check, Internet Speed Check, SIM Swap and Mobile Services Management (MSM v11).
- Dual-era serving on the v2 SDK (`^2.0.0-beta.5`): one shared `McpServerFactory` via
  `createMcpHandler({ legacy: 'stateless' })` + `toNodeHandler` for HTTP and `serveStdio`
  for stdio; identical deterministic tool list for every caller and both protocol eras
  (proved by `scripts/smoke-dual-era.mjs`).
- Gateway mode (`AUTH_MODE=gateway`): per-request credential binding from
  `X-KPN-Client-Id` / `X-KPN-Client-Secret` and the optional `X-KPN-MSM-Client-Id` /
  `X-KPN-MSM-Client-Secret` pair, with a 401 JSON-RPC (-32001) gate before the MCP handler
  that also rejects a half MSM pair. No env fallback. `KPN_BASE_URL` is env-mode only.
- Fail-closed confirmation (MRTR `inputRequired` seam, `confirm_destructive_action` for
  non-interactive callers) on the SIM block/unblock/replace, order authorize/cancel and
  PUK-reveal tools; destructive-warning convention enforced by
  `scripts/lint-destructive-warnings.mjs` in CI.
- PIN/PUK masking on every tool that returns contract or order details.
- GHCR container (node:22-alpine multi-stage, non-root, linux/amd64), MCP Registry
  `server.json`, fleet CI via the centralized reusable release workflow. No deploy job:
  KPN is a conduit-only vendor.

### Changed

- Depend on `@wyre-ai/node-kpn` `^2.1.0` (tag `v2.1.0`, node-kpn#5). kpn-mcp
  hands token minting to `GrexxClient`, which sends HTTP Basic first and may fall
  back to form-body `client_id` / `client_secret` after HTTP 400/401
  `invalid_client`. `POST /realtime` still uses the Bearer token.
- The default tool catalog now contains the four Grexx tools. Set
  `KPN_LEGACY_DEVELOPER_API=1` to append the existing 23 developer.kpn.com tools.
- Grexx uses OAuth 2.0 client credentials and Bearer authentication, with token minting,
  caching, and the 401 remint handled by `@wyre-ai/node-kpn`. Gateway mode requires
  `X-KPN-Grexx-Username` and `X-KPN-Grexx-Password`, with no environment credential
  fallback. Grexx base and token URLs are environment-only; caller-supplied URL
  headers are rejected with HTTP 400.
- Legacy tools use the `@wyre-ai/node-kpn/legacy` export.

### Notes

- Built from KPN's published OpenAPI specs and documentation, and tested against mocks only.
  It has not yet been run against live KPN credentials.
