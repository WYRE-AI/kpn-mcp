# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are cut by semantic-release from Conventional Commits.

## [Unreleased]

### Added

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

### Notes

- `@wyre-ai/node-kpn` is a `file:../node-kpn` dependency during the initial build
  and is swapped for the published `^1.0.0` before the first release.
