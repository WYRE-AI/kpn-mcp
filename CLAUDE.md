# kpn-mcp

MCP server for KPN IRMA on Grexx (OAuth client-credentials, realtime XML).
SDK: `@wyre-ai/node-kpn` package root (`GrexxClient`), not `/legacy`.
Grexx contract: `docs/GREXX.md`. The developer.kpn.com catalog is
`docs/DESIGN.md` and is off unless `KPN_LEGACY_DEVELOPER_API=1`.

## Learnings - 2026-10-09

- **node-kpn 2.0.1 sends Grexx client credentials as HTTP Basic first.** Tag
 `v2.0.1` (`9067bbe`). Depend on `^2.0.1`. This server does not mint the Grexx
 token and does not post `client_id` / `client_secret` in a form body. `POST
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
- **Phase-1 tools follow SDK builders.** `kpn_grexx_test_connection` and
  `kpn_grexx_zipcode_check` only. Do not invent XSD fields for the other
  realtime calls until node-kpn ships those builders.
- **node-kpn 2.0.1 is the Grexx export** (tag `v2.0.1`, GitHub Packages).
  Depend on `^2.0.1` from the package root. Legacy tools import
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
