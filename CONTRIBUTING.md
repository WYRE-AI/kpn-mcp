# Contributing to kpn-mcp

Thanks for helping improve the KPN MCP server.

## Development setup

```bash
export NODE_AUTH_TOKEN=$(gh auth token)   # GitHub Packages registry auth
npm install
```

Until `@wyre-ai/node-kpn@1.0.0` is published, the dependency points at a sibling
`../node-kpn` checkout (see README "Local-dev note").

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
- **401 gate before the handler** in gateway mode; never fall through to env credentials,
  and reject a half MSM pair.
- **No base URL from headers.** `KPN_BASE_URL` is env-mode only.
- **MRTR safety**: every read and elicitation happens before the single mutating KPN call.
- **No retries on MSM order POSTs**; the SDK enforces this, handlers must not add their own.
- **PIN/PUK masked** in every contract or order result except `kpn_mobile_contracts_get_puk`.
- Every handler returns `isError` results and never throws; empty results are `isError`
  with an explicit "no X found" message (except "no disturbances", which is a real answer).
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
