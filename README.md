# kpn-mcp

MCP server for the **KPN Grexx / IRMA** partner pilot (acceptatie). Phase 1 is
**15 realtime reads** on `POST /realtime`. Queued calls, OrderModule and inbound
notifications are not exposed: the partner portal has no Proxymodule tile, so
those results would never arrive.

Client: [`@wyre-ai/node-kpn` 2.0](https://github.com/WYRE-AI/node-kpn/pull/1)
(`cursor/grexx-irma-client-00dd`) until that release is published. The client
sends **OAuth Bearer** by default (`authMode: 'oauth'`). Set
`KPN_GREXX_AUTH_MODE=basic` only if acceptatie answers Grexx code 101.

## Tools

1. `kpn_grexx_test_connection`
2. `kpn_grexx_zipcode_check` — `ZipCodeCheckRequest_V6`
3. `kpn_grexx_prequalification` — `PrequalificationRequest_V2`
4. `kpn_grexx_carrier_info` — `CarrierInfoRequest_V1`
5. `kpn_grexx_radius_check` — `RadiusCheckRequest_V1` (RADIUS passwords masked)
6. `kpn_grexx_ras_check` — `RasCheckRequest_V1`
7. `kpn_grexx_start_line_diagnose` — `StartLineDiagnoseRequest_V1` (start only)
8. `kpn_grexx_customer_data` — `CustomerDataRequest_V1`
9. `kpn_grexx_order_summary` — `OrderSummaryRequest_V1`
10. `kpn_grexx_order_data` — `OrderDataRequest_V1`
11. `kpn_grexx_get_sim` — `GetSimRequest_V1` (integer `OrderId`; PUK / eSIM codes masked)
12. `kpn_grexx_mobile_settings` — `GetMobileSettingsRequest_V1`
13. `kpn_grexx_mobile_usage` — `GetMobileSubscriptionUsageRequest_V1`
14. `kpn_grexx_mobile_orders` — `GetMobileSubscriptionOrdersRequest_V1`
15. `kpn_grexx_available_portings` — `AvailablePortingsRequest_V1`

## Credentials

| Env (env mode) | Gateway header (`AUTH_MODE=gateway`) | Required |
|---|---|---|
| `KPN_GREXX_USERNAME` | `X-KPN-Grexx-Username` | yes |
| `KPN_GREXX_PASSWORD` | `X-KPN-Grexx-Password` | yes |
| `KPN_GREXX_BASE_URL` | none | yes, env only |
| `KPN_GREXX_AUTH_MODE` | none | no; `oauth` (default) or `basic` |

Acceptatie base URL (set it explicitly; it is not a default):

`https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/697fbf4b18a076446aa2cd4a/`

Username and password come from the portal **API Gegevens** page. Do not commit them.
In gateway mode a request missing either Grexx header is `401` before the handler runs.
`KPN_GREXX_BASE_URL` is never taken from a header. `CONDUIT_S2S_SECRET` / `X-Gateway-S2S` is unchanged.

## Running

```bash
npm install
npm run build
npm test
npm run smoke          # both protocol eras, no Grexx calls
npm run smoke:grexx    # skips unless KPN_GREXX_USERNAME, PASSWORD and BASE_URL are set
```

Live acceptatie check (not used in CI):

```bash
export KPN_GREXX_USERNAME=...
export KPN_GREXX_PASSWORD=...
export KPN_GREXX_BASE_URL='https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/697fbf4b18a076446aa2cd4a/'
# optional: KPN_GREXX_AUTH_MODE=basic
# optional: KPN_GREXX_SMOKE_ZIPCODE=1012JS KPN_GREXX_SMOKE_HOUSE_NUMBER=1 KPN_GREXX_SMOKE_PORTFOLIO=All
npm run build && npm run smoke:grexx
```

Docker (linux/amd64). The image installs `node-kpn` from the GitHub branch, so the builder needs `git` (already in the Dockerfile):

```bash
docker build --platform linux/amd64 -t kpn-mcp .
```

## License

Apache-2.0 © WYRE Technology
