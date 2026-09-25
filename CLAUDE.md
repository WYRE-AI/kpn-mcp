# kpn-mcp

MCP server for KPN's developer APIs (Disturbance Check, Speed Check, SIM Swap,
Mobile Services Management v11). SDK: `@wyre-ai/node-kpn` (WYRE-AI/node-kpn).
Build contract and scope decisions: `docs/DESIGN.md`.

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
