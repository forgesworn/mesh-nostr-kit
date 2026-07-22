# CLAUDE.md — mesh-nostr-kit

Nostr relay transport for opaque mesh-kit frames.

## Commands

- `npm run build` — compile TypeScript to dist/
- `npm test` — run all tests (vitest)
- `npm run typecheck` — type-check without emitting

## Structure

- `src/transport.ts` — connectNostrMeshTransport, publishGapForRelays, the WideBridgeLane implementation (publish pacing, dedup, watchdog reconnect)
- `src/event.ts` — NIP-16 frame event encode/decode
- `src/room-seal.ts` — AES-256-GCM room sealing, HKDF room key/tag derivation
- `src/json-bytes.ts` — recursive byte-safe JSON for Uint8Array payloads
- `src/nostr-tools.ts` — createNostrToolsPool / createEphemeralNostrSigner (standard nostr-tools adapters)
- `src/index.ts` — barrel re-export
- `src/compatibility.test.ts` — frozen-vector tests against Meatchat's original transport
- `compatibility-vectors/` — frozen fixture data (event kind, room tag, sealed bytes, pacing order, reconnect contract)

## Exports

Single entry point, no subpath exports:

- `mesh-nostr-kit` -- full API: transport, frame events, room sealing, byte-safe JSON, nostr-tools adapters

## Conventions

- **British English** — licence, colour, behaviour
- **ESM-only** — `"type": "module"` in package.json, `.js` extensions on relative imports
- **TDD** — write failing test first, then implement
- **Frame opacity** — never interpret `frame.kind`/`frame.payload` beyond passing them through sealed and JSON-safe; that's the consumer's domain
- **Git:** commit messages use `type: description` format
- **Git:** Do NOT include `Co-Authored-By` lines in commits

## Release & Versioning

No dedicated release workflow exists yet. `.github/workflows/ci.yml` runs `npm ci`, `npm test`, `npm run typecheck`, `npm run build` and `npm pack --dry-run` on every push to `main` and on pull requests — that is the full extent of current automation. Releases are manual:

1. Bump `package.json` version by hand (e.g. `0.1.0` → `0.2.0`)
2. Add a `CHANGELOG.md` entry under the new version heading
3. Commit (`chore: release 0.2.0`), push main, tag (`git tag v0.2.0 && git push --tags`)
4. `npm publish` from a clean tree — `prepublishOnly` gates this locally with typecheck + test + build
5. Create a GitHub Release pointing at the tag

Semver rules of thumb:

| Change | Bump |
|---|---|
| Bug fix, no API change | Patch (x.y.Z) |
| New feature, backwards compatible | Minor (x.Y.0) |
| Breaking API change | Major (X.0.0) |
| Tooling, docs, refactor with no behaviour change | Patch or none |

**Known constraint:** `mesh-kit` is a private `@forgesworn` git dependency pinned to a commit SHA (CI authenticates it with a `FORGESWORN_READ_PAT` repo secret over HTTPS). Until `mesh-kit` is itself public or published to npm, an external `npm install mesh-nostr-kit` will fail for anyone without read access to `forgesworn/mesh-kit` — worth resolving before, or as part of, open-sourcing this package.
