# AGENTS.md — mesh-nostr-kit

Instructions in this file apply to the entire repository.

## Project Summary
- Nostr relay transport for opaque [`mesh-kit`](https://github.com/forgesworn/mesh-kit) frames — extracted from Meatchat's proven relay lane without bringing Nostr into mesh-kit core.
- ESM-only package (`"type": "module"`), single entry point, no subpath exports.
- Requires Node.js 20+.
- Runtime dependencies: `mesh-kit` (private `@forgesworn` git dependency, pinned to a commit SHA) and `nostr-tools`.

## Key Commands
- `npm run build` — compile TypeScript into `dist/`
- `npm test` — run the Vitest suite
- `npm run typecheck` — TypeScript type-check without emitting
- `npm run prepublishOnly` — typecheck + test + build gate npm runs automatically before publish

## Repository Structure
- `src/transport.ts` — `connectNostrMeshTransport`, `publishGapForRelays`; the `WideBridgeLane` (broadcast/send/subscribe/tap/publishAs/stop) implementation, publish pacing, dedup and watchdog reconnect logic
- `src/event.ts` — NIP-16 frame event encode/decode (`encodeFrameEvent`, `decodeFrameEvent`, `DEFAULT_MESH_EVENT_KIND`)
- `src/room-seal.ts` — AES-256-GCM room sealing/opening, HKDF room key and room tag derivation
- `src/json-bytes.ts` — recursive byte-safe JSON so `Uint8Array` payloads survive `JSON.stringify`/`parse`
- `src/nostr-tools.ts` — `createNostrToolsPool` / `createEphemeralNostrSigner`, the standard nostr-tools implementations of the injectable pool/signer ports
- `src/index.ts` — barrel re-export
- `src/compatibility.test.ts` — frozen-vector compatibility tests against Meatchat's original transport
- `compatibility-vectors/meatchat-nostr-v1.json` — frozen fixture data (event kind, room tag, sealed bytes, pacing order, reconnect contract)
- `dist/` — build output (generated, not committed)

## Coding Conventions
- Use British English spelling in identifiers and prose where applicable: `licence`, `colour`, `behaviour`.
- Keep `mesh-kit` frames opaque — this package must never interpret `frame.kind` / `frame.payload` beyond passing them through sealed and JSON-safe. Domain logic belongs to the consumer.
- Keep changes minimal and consistent with the existing module layout (one concern per file: transport, event, room-seal, json-bytes, nostr-tools).
- Prefer TDD when changing behaviour: add or update a failing test first, then implement.
- Maintain ESM-compatible imports/exports — relative imports use explicit `.js` extensions even in `.ts` source (`Node16` module resolution).
- Never change the frozen compatibility vectors (`compatibility-vectors/meatchat-nostr-v1.json`) or the behaviour they assert without a deliberate, explicitly-approved protocol change — they exist to guarantee wire compatibility with Meatchat's original transport.

## Working Guidelines
- Do not edit generated output in `dist/` by hand unless the user explicitly asks for it.
- Prefer targeted tests for the area being changed before running the full suite.
- Update documentation (`README.md`, `llms.txt`) when the public API or behaviour changes.
- `mesh-kit` is installed as a private git dependency pinned to a commit SHA — do not swap it for a semver range or bump the pinned commit without checking with the user.
- `MeshPool` and `NostrEventSigner` are injectable ports; do not hard-code `nostr-tools` types into `transport.ts` — the `nostr-tools.ts` adapters are optional convenience only.

## Release Notes
- No dedicated release workflow exists yet — `.github/workflows/ci.yml` runs `npm ci`, `npm test`, `npm run typecheck`, `npm run build` and `npm pack --dry-run` on every push to `main` and on pull requests. Releases are currently manual (bump version, update `CHANGELOG.md`, tag, `npm publish`).
- Conventional commit prefixes matter for future automated releases: `fix:` for patch, `feat:` for minor, `BREAKING CHANGE:` for major.
- Tests must pass before release-related changes are considered complete.
