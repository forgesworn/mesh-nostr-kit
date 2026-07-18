# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-18

Initial release of `mesh-nostr-kit` — Nostr relay transport for opaque
[`mesh-kit`](https://github.com/forgesworn/mesh-kit) frames, extracted
from Meatchat's relay lane.

### Added

- Nostr mesh transport: NIP-16 frame events with an opaque room tag,
  AES-256-GCM room sealing using the `meatchat/room-seal/v1` HKDF domain,
  recursive byte-safe JSON for `Uint8Array` payloads, ordered seal/open
  chains, event and bridge deduplication, control/bulk publish pacing,
  and silent-subscription recovery.
- The `WideBridgeLane` tap/publish surface used by mesh-kit bridges.
- `createNostrToolsPool` and `createEphemeralNostrSigner`, the standard
  nostr-tools implementations of the pool and signer the transport
  requires.

### Changed

- CI forces public dependencies over HTTPS.

[0.1.0]: https://github.com/forgesworn/mesh-nostr-kit/releases/tag/v0.1.0
