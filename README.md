# mesh-nostr-kit

Nostr relay transport for opaque [`mesh-kit`](https://github.com/forgesworn/mesh-kit)
frames. It was extracted from Meatchat's proven relay lane without bringing
Nostr into mesh-kit core.

The library owns the stable mechanics:

- NIP-16 frame events with an opaque room tag;
- AES-256-GCM room sealing using the existing
  `meatchat/room-seal/v1` HKDF domain;
- recursive byte-safe JSON for `Uint8Array` payloads;
- ordered seal/open chains, event and bridge deduplication;
- control/bulk publish pacing and silent-subscription recovery;
- the `WideBridgeLane` tap/publish surface used by mesh-kit bridges.

The consumer supplies relay URLs, pool, signer, node id, room, event kind,
clock, priority policy, pacing values, health hook and watchdog tuning. The
helpers `createNostrToolsPool` and `createEphemeralNostrSigner` provide the
standard nostr-tools implementation without making it mandatory in tests or
other runtimes.

## Install

```sh
npm install mesh-nostr-kit
```

ESM-only, single entry point (no subpath exports), MIT licensed. Requires
Node.js 20+.

## Quick Start

```ts
import {
  connectNostrMeshTransport,
  createEphemeralNostrSigner,
  createNostrToolsPool,
} from 'mesh-nostr-kit'

const transport = await connectNostrMeshTransport({
  relays: ['wss://relay.example'],
  room: 'venue:opaque-room-secret',
  selfId: 'persona-fingerprint',
  pool: createNostrToolsPool(),
  signer: createEphemeralNostrSigner(),
  priority: (frame) => frame.kind === 'channel' ? 'bulk' : 'control',
})

transport.subscribe((frame) => console.log(frame.kind, frame.from, frame.payload))
transport.broadcast({ kind: 'presence', payload: { at: Date.now() } })
transport.stop()
```

The lower-level primitives are exported too, for a custom `MeshPool`/signer
or an entirely different transport built on the same wire format:

```ts
import { deriveRoomKey, sealRoomFrame, openRoomFrame, jsonSafePayload, revivePayload } from 'mesh-nostr-kit'

const key = await deriveRoomKey('venue:opaque-room-secret')
const sealed = await sealRoomFrame(key, {
  k: 'channel',
  p: jsonSafePayload({ bytes: new Uint8Array([0, 127, 255]) }),
  f: 'alice',
})

const body = await openRoomFrame(key, sealed)
const payload = revivePayload(body!.p) // { bytes: Uint8Array([0, 127, 255]) }
```

## API Reference

All exports come from the single entry point `mesh-nostr-kit`.

### Transport

| Function | Description |
|----------|-------------|
| `connectNostrMeshTransport(options)` | Connect an ordered, sealed `MeshTransport` over an injected Nostr pool and signer. Returns a `RunningNostrMeshTransport` (`broadcast`, `send`, `subscribe`, `tap`, `publishAs`, `stop`) |
| `publishGapForRelays(relays, options)` | Resolve the strictest relay publish gap from a per-relay policy |

**Types:** `MeshPool`, `NostrEventSigner`, `NostrMeshTransportOptions`, `NostrSignedEvent`, `RelayHealth`, `RunningNostrMeshTransport`

### Frame events

| Export | Description |
|----------|-------------|
| `encodeFrameEvent(sealedContent, options)` | Build a NIP-16 event template from sealed content |
| `decodeFrameEvent(event, options)` | Extract sealed content from an event, or `null` if kind/tag/content don't match |
| `DEFAULT_MESH_EVENT_KIND` | `20316` — Meatchat's original ephemeral event kind |

**Types:** `FrameEventOptions`, `NostrEventLike`, `NostrEventTemplate`

### Room sealing

| Export | Description |
|----------|-------------|
| `deriveRoomKey(room, options?)` | Derive an AES-256-GCM `CryptoKey` from a room string via HKDF |
| `deriveRoomTag(room)` | SHA-256 hex digest of the room, used as the opaque `t` tag |
| `sealRoomFrame(key, body, options?)` | Encrypt a frame body to base64 (`iv \|\| ciphertext`) |
| `openRoomFrame(key, content)` | Decrypt and validate a sealed frame body, or `null` if invalid |
| `DEFAULT_ROOM_SEAL_DOMAIN` | `'meatchat/room-seal/v1'` — HKDF salt/domain separator |

**Types:** `RoomKeyOptions`, `SealOptions`, `SealedFrameBody`

### Byte-safe JSON

| Function | Description |
|----------|-------------|
| `jsonSafePayload(value)` | Recursively wrap every `Uint8Array` as `{ $u8: base64 }` |
| `revivePayload(value)` | Recursively reverse `jsonSafePayload` |
| `bytesToBase64(bytes)` | Encode bytes as base64 |
| `base64ToBytes(value)` | Decode base64 to bytes, or `null` on invalid input |

### nostr-tools helpers

| Function | Description |
|----------|-------------|
| `createNostrToolsPool()` | Standard `MeshPool` wrapping nostr-tools' `SimplePool` |
| `createEphemeralNostrSigner(secretKey?)` | Standard `NostrEventSigner` wrapping nostr-tools' `finalizeEvent`, with a throwaway or supplied secret key |

## Compatibility

`compatibility-vectors/meatchat-nostr-v1.json` freezes the original event kind,
room tag, domain-separated seal bytes, byte marker, pacing order and reconnect
contract from Meatchat commit `5fa6518abb9abf3e031b5771d94ca7d1639986d1`.
`src/compatibility.test.ts` asserts every value in the vector on each test run,
so a regression in wire compatibility fails CI.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
```

## For AI Assistants

See [llms.txt](./llms.txt) for a concise API summary, or [AGENTS.md](./AGENTS.md)
for repository conventions and working guidelines.

## Licence

MIT
