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
```

`compatibility-vectors/meatchat-nostr-v1.json` freezes the original event kind,
room tag, domain-separated seal bytes, byte marker, pacing order and reconnect
contract from Meatchat commit `5fa6518abb9abf3e031b5771d94ca7d1639986d1`.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
```

ESM-only, MIT licensed.
