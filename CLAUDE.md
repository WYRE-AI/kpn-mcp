# kpn-mcp

MCP server for KPN IRMA on Grexx (OAuth client-credentials, realtime XML).
SDK: `@wyre-ai/node-kpn` package root (`GrexxClient`), not `/legacy`.
Grexx contract: `docs/GREXX.md`. The developer.kpn.com catalog is
`docs/DESIGN.md` and is off unless `KPN_LEGACY_DEVELOPER_API=1`.

## Learnings - 2026-10-09

- **IRMA enforces XSD element order and rejects with HTTP 200.** A request with
  elements out of `xs:sequence` order returns HTTP 200 `<NinaResponse>` with
  `IsSuccess=false`, `ErrorCode 109` and the expected element list. 105, 107 and
  68 arrive the same way. node-kpn 2.1.0 still returns it as success (no
  `Status`); `ninaError` in `handlers/grexx-realtime.ts` turns it into the SDK's
  typed error, and `describeGrexxError` decodes it when a builder rejects it as
  an unexpected root. CustomerData, CarrierInfo, Prequalification, RadiusCheck,
  RasCheck and GetMobileSettings have no `Status`; a filled root `ErrorMessage`
  is their only failure signal.
- **Calls without a node-kpn builder are data.** Add a spec to
  `src/tools/grexx-realtime.ts` (fields in request-XSD order, from the portal's
  Webservice Beschrijvingen), a response fixture in
  `src/__tests__/fixtures/grexx/`, and a `CASES` row (args plus the expected
  body) in `handlers-grexx-realtime.test.ts`. The portal CSV export
  (`realtime calls.csv`) embeds every request and response XSD.
- **Secrets in live responses.** RadiusCheck returns the PPP `Password` in clear
  text; GetSim and mobile orders return `Puc1` and eSIM codes. They are masked,
  and `describeGrexxError` never echoes a response body (node-kpn uses the raw
  body as the error message when Grexx sends an error without one).
- **Acceptatie test data:** customer 555799, FTTH order 11640032 (radius/ras),
  mobile orders 11638192/11638193 (`mobile_orders`), HIP group 11638620, carrier
  info at 9999ZZ 1. No acceptatie mobile order has an active SIM, so get_sim,
  usage and settings return IRMA errors. Prequalification is
  `107 Message type not allowed` for the WYRE API account. IRMA accepts
  `2025-01-01T00:00:00[Z|±hh:mm]` and rejects date-only values with 109.
- **node-kpn 2.1.0 adds Prequalification_V2 and OrderData_V1.** Tag `v2.1.0`
  (`ca0db33d`, [node-kpn#5](https://github.com/WYRE-AI/node-kpn/pull/5)). Depend
  on `^2.1.0`. Registered reads are `kpn_grexx_prequalification` (address and
  product-type availability per supplier; `hasBroadband` true requires
  `serviceId` or `referencePhoneNumber`) and `kpn_grexx_order_data` (`orderId`
  to customer id, product code, and quantity). Schemas use the SDK enums
  (`PREQUALIFICATION_PRODUCT_TYPES`, `PREQUALIFICATION_SUPPLIERS`). Results
  omit raw XML.
- **node-kpn 2.0.1 sends Grexx client credentials as HTTP Basic first.** Tag
 `v2.0.1` (`9067bbe`). kpn-mcp hands token minting to
 `GrexxClient`, which sends HTTP Basic first and may fall back to form-body
 `client_id` / `client_secret` after HTTP 400/401 `invalid_client`. `POST
 /realtime` still uses the Bearer token; Basic Auth there is still rejected.

## Learnings - 2026-10-07

- **Acceptatie auth is OAuth client_credentials, then Bearer.** Grexx #4029
 (2026-10-07) rejects Basic Auth on `/realtime` (`403 Auth method Basic not
 allowed`). Do not document Basic as the default for `/realtime`. Token mint
 and cache live in node-kpn; this server passes username, password, and env
 URLs only.
- **URL headers are rejected.** `KPN_GREXX_BASE_URL` and `KPN_GREXX_TOKEN_URL`
  are env-only. Gateway headers are `X-KPN-Grexx-Username` and
  `X-KPN-Grexx-Password`.
- **Phase-1 tools follow SDK builders or XSD specs.** (Superseded 2026-10-09:
  calls without a node-kpn builder are specs copied from the request XSDs in
  `src/tools/grexx-realtime.ts`; nothing is invented.)
- **node-kpn 2.1.0 is the Grexx export** (tag `v2.1.0`, GitHub Packages).
  Depend on `^2.1.0` from the package root. Legacy tools import
  `@wyre-ai/node-kpn/legacy`.

## Learnings - 2026-09-25

- **The public spec mirror overstates the surface.** api-evangelist/kpn lists ~100
  OpenAPI files, not KPN's advertised 34; most are resold Vonage/Apidaze CPaaS,
  demo/testing-only webhooks, Meraki-shaped managed-network proxies or internal
  controllers. Only four genuine KPN products made v1 (see DESIGN.md §1.2 for what
  was cut and why).
- **Two token realms.** Network/SIM products mint at
  `/oauth/client_credential/accesstoken`; MSM mints at `/oauth/grip/msm/accesstoken`
  and may need a customer-bound app. A token mints even when a product isn't added to
  the project, so entitlement failures surface as 401/403 on the call, not at mint.
- **developer.kpn.com login rejects automated browsers** ("Browser check failed").
  Creating the sandbox app and keys has to be done by a human.
- **Partially live-verified with fake credentials.** Both token endpoints and all four
  product base paths exist on api-prd.kpn.com (unknown paths return 404
  `ApplicationNotFound`; ours return invalid-token). The MSM token endpoint rejects a
  bad client with **HTTP 500** + `invalid_client-invalid_client_id`, not 401, and SIM
  Swap sends its invalid-token fault as HTTP 500. No authenticated call has been made;
  MSM write tools have mock-only coverage.
- **MSM writes are never retried** (a duplicate block/authorize is a real side effect),
  and success means an order was created, not completed.
- **Fleet conventions moved on from the scaffolding skill**: `@wyre-ai` scope,
  `ghcr.io/wyre-ai`, WYRE-AI/reusable-workflows release caller, no mcp-assert caller,
  and the standard s2s-verify (`X-Gateway-S2S`) wrapper.
- **Release pipeline:** the reusable workflow's "Verify registry listing" step can hang
  after a successful publish; check the registry directly
  (`registry.modelcontextprotocol.io/v0/servers?search=io.github.WYRE-AI/kpn-mcp`).
