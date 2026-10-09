# Contributing to kpn-mcp

Thanks for helping improve the KPN MCP server.

## Development setup

```bash
export NODE_AUTH_TOKEN=$(gh auth token)   # GitHub Packages registry auth
npm install
```

## Workflow

- `npm run build`: tsc build to `dist/`.
- `npm test`: vitest suite. Handler tests use `src/__tests__/stub-client.ts`, never the network.
- `npm run lint`: eslint; `npm run typecheck`: `tsc --noEmit`.
- `node scripts/lint-destructive-warnings.mjs src`: destructive-warning convention gate.
- `npm run smoke`: dual-era serving proof (run after build).

All of the above must pass before a PR is merged. The build contract is `docs/DESIGN.md`;
if code and design disagree, fix one of them in the same PR.

## Invariants (do not break)

- **Stateless tool surface**: `tools/list` must return the same tools in the same order for
  every caller. No sessions, no per-user variance, no runtime sorting/filtering.
- **Never `legacy: 'reject'`** on `createMcpHandler`: it turns away every 2025-era client.
- **401 gate before the handler** in gateway mode; never fall through to env credentials.
  Required headers are `X-KPN-Grexx-Username` and `X-KPN-Grexx-Password`. When
  `KPN_LEGACY_DEVELOPER_API=1`, a half MSM pair is still rejected.
- **No base URL or token URL from headers.** `KPN_GREXX_BASE_URL` and
  `KPN_GREXX_TOKEN_URL` are env-only. A URL header is HTTP 400.
- **Grexx-first tool list.** Default `tools/list` is the `kpn_grexx_*` tools. A realtime
  tool uses either an `@wyre-ai/node-kpn` builder or a spec in
  `src/tools/grexx-realtime.ts` whose fields are copied from the request XSD, in XSD
  order. Legacy `kpn_*` tools stay behind `KPN_LEGACY_DEVELOPER_API=1`.
- **MRTR safety**: every read and elicitation happens before the single mutating KPN call.
- **No retries on MSM order POSTs**; the SDK enforces this, handlers must not add their own.
- **PIN/PUK masked** in every contract or order result except `kpn_mobile_contracts_get_puk`.
- Every handler returns `isError` results and never throws. Legacy handlers make empty
  results `isError` with an explicit "no X found" message (except "no disturbances", which
  is a real answer); Grexx search tools return an empty page as data.
- Gated tools carry the description warning prefix, `CONFIRM_ARG_PROPERTY`, and end with
  "Confirm with the user before invoking."
- `/health` stays shallow and unauthenticated. Logs never contain tool arguments, results
  or credentials.

## Commit messages

This repo releases via semantic-release; commit messages must follow
[Conventional Commits](https://www.conventionalcommits.org/):

- `fix:`: patch release
- `feat:`: minor release
- `feat!:` / `BREAKING CHANGE:`: major release
- `docs:`, `test:`, `chore:`, `refactor:`: no release
