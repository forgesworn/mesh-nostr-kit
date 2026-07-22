import type { MeshFrame } from 'mesh-kit'
import { describe, expect, it } from 'vitest'
import {
  connectNostrMeshTransport,
  publishGapForRelays,
  type MeshPool,
  type NostrEventSigner,
  type NostrSignedEvent,
  type RelayHealth,
} from './index.js'

const ROOM = 'venue:transport-test-room'
const flush = (ms = 15): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function signer(prefix: string): NostrEventSigner {
  let next = 0
  return {
    sign: (template) => ({
      ...template,
      id: `${prefix}-${++next}`,
      pubkey: prefix,
      sig: 'test-signature',
    }),
  }
}

class MemoryRelay {
  private readonly subscriptions = new Set<{
    filter: Record<string, unknown>
    onevent: (event: NostrSignedEvent) => void
    oneose?: () => void
  }>()
  readonly published: NostrSignedEvent[] = []

  pool(): MeshPool {
    const owned = new Set<(typeof this.subscriptions extends Set<infer T> ? T : never)>()
    return {
      subscribeMany: (_relays, filter, params) => {
        const subscription = { filter, ...params }
        this.subscriptions.add(subscription)
        owned.add(subscription)
        queueMicrotask(() => params.oneose?.())
        return {
          close: () => {
            this.subscriptions.delete(subscription)
            owned.delete(subscription)
          },
        }
      },
      publish: (_relays, event) => {
        this.published.push(event)
        queueMicrotask(() => {
          for (const subscription of [...this.subscriptions]) subscription.onevent(event)
        })
        return []
      },
      close: () => {
        for (const subscription of owned) this.subscriptions.delete(subscription)
        owned.clear()
      },
    }
  }
}

/** A pool whose subscriptions never fire onevent/oneose -- simulates an unreachable relay. */
const silentPool: MeshPool = {
  subscribeMany: () => ({ close: () => {} }),
  publish: () => [],
  close: () => {},
}

describe('publishGapForRelays', () => {
  it('returns the default gap when there are no relays', () => {
    expect(publishGapForRelays([], { defaultGapMs: 900 })).toBe(900)
  })

  it('returns the default gap when no per-relay overrides are given', () => {
    expect(publishGapForRelays(['wss://a', 'wss://b'], { defaultGapMs: 500 })).toBe(500)
  })

  it('picks the strictest (maximum) gap across relays with mixed overrides', () => {
    const gap = publishGapForRelays(['wss://fast', 'wss://slow', 'wss://unlisted'], {
      defaultGapMs: 500,
      byRelay: { 'wss://fast': 100, 'wss://slow': 2000 },
    })
    expect(gap).toBe(2000)
  })

  it('normalises trailing slashes before matching byRelay keys', () => {
    const gap = publishGapForRelays(['wss://relay.example///'], {
      defaultGapMs: 200,
      byRelay: { 'wss://relay.example': 3000 },
    })
    expect(gap).toBe(3000)
  })
})

describe('connectNostrMeshTransport addressing', () => {
  it('delivers a directed send() only to the addressed peer, but tap sees every frame', async () => {
    const relay = new MemoryRelay()
    const alice = await connectNostrMeshTransport({
      relays: ['memory://relay'], room: ROOM, selfId: 'alice', pool: relay.pool(), signer: signer('alice'), publishGapMs: 0,
    })
    const bob = await connectNostrMeshTransport({
      relays: ['memory://relay'], room: ROOM, selfId: 'bob', pool: relay.pool(), signer: signer('bob'), publishGapMs: 0,
    })
    const carol = await connectNostrMeshTransport({
      relays: ['memory://relay'], room: ROOM, selfId: 'carol', pool: relay.pool(), signer: signer('carol'), publishGapMs: 0,
    })

    const bobReceived: MeshFrame[] = []
    const carolReceived: MeshFrame[] = []
    const carolTapped: Array<{ frame: MeshFrame; to?: string }> = []
    bob.subscribe((frame) => bobReceived.push(frame))
    carol.subscribe((frame) => carolReceived.push(frame))
    carol.tap((frame, to) => carolTapped.push({ frame, to }))

    alice.send('bob', { kind: 'channel', payload: { secret: 1 } })
    await flush()

    expect(bobReceived).toEqual([{ kind: 'channel', payload: { secret: 1 }, from: 'alice' }])
    expect(carolReceived).toEqual([])
    expect(carolTapped).toEqual([{ frame: { kind: 'channel', payload: { secret: 1 }, from: 'alice' }, to: 'bob' }])

    alice.stop()
    bob.stop()
    carol.stop()
  })

  it('does not deliver a broadcast frame back to its own sender', async () => {
    const relay = new MemoryRelay()
    const alice = await connectNostrMeshTransport({
      relays: ['memory://relay'], room: ROOM, selfId: 'alice', pool: relay.pool(), signer: signer('alice'), publishGapMs: 0,
    })
    const aliceReceived: MeshFrame[] = []
    alice.subscribe((frame) => aliceReceived.push(frame))

    alice.broadcast({ kind: 'presence', payload: {} })
    await flush()

    expect(aliceReceived).toEqual([])
    alice.stop()
  })
})

describe('connectNostrMeshTransport bridging', () => {
  it('suppresses its own forwarded event when publishAs echoes back via the relay', async () => {
    const relay = new MemoryRelay()
    const bridge = await connectNostrMeshTransport({
      relays: ['memory://relay'], room: ROOM, selfId: 'bridge-node', pool: relay.pool(), signer: signer('bridge'), publishGapMs: 0,
    })
    const tapped: MeshFrame[] = []
    bridge.tap((frame) => tapped.push(frame))

    bridge.publishAs('remote-origin', { kind: 'channel', payload: { hop: 1 } }, { id: 'fwd-1' })
    await flush()

    // Forwarding on behalf of another node must not re-trigger the bridge's own tap/subscribe
    // when the relay echoes the published event back -- otherwise bridges would loop forever.
    expect(tapped).toEqual([])
    bridge.stop()
  })

  it('suppresses a duplicate bridge id even when it arrives as two distinct signed events', async () => {
    const relay = new MemoryRelay()
    const bob = await connectNostrMeshTransport({
      relays: ['memory://relay'], room: ROOM, selfId: 'bob', pool: relay.pool(), signer: signer('bob'), publishGapMs: 0,
    })
    const bobTapped: MeshFrame[] = []
    bob.tap((frame) => bobTapped.push(frame))

    const relayNodeA = await connectNostrMeshTransport({
      relays: ['memory://relay'], room: ROOM, selfId: 'relay-a', pool: relay.pool(), signer: signer('relay-a'), publishGapMs: 0,
    })
    const relayNodeB = await connectNostrMeshTransport({
      relays: ['memory://relay'], room: ROOM, selfId: 'relay-b', pool: relay.pool(), signer: signer('relay-b'), publishGapMs: 0,
    })

    relayNodeA.publishAs('origin-node', { kind: 'channel', payload: { hop: 1 } }, { id: 'shared-bridge-id' })
    await flush()
    relayNodeB.publishAs('origin-node', { kind: 'channel', payload: { hop: 1 } }, { id: 'shared-bridge-id' })
    await flush()

    expect(bobTapped).toEqual([{ kind: 'channel', payload: { hop: 1 }, from: 'origin-node' }])

    bob.stop()
    relayNodeA.stop()
    relayNodeB.stop()
  })
})

describe('connectNostrMeshTransport lifecycle', () => {
  it('stop() prevents any further outbound publish', async () => {
    const relay = new MemoryRelay()
    const transport = await connectNostrMeshTransport({
      relays: ['memory://relay'], room: ROOM, selfId: 'alice', pool: relay.pool(), signer: signer('alice'), publishGapMs: 0,
    })

    transport.stop()
    transport.broadcast({ kind: 'presence', payload: {} })
    await flush()

    expect(relay.published).toEqual([])
  })

  it('honours an explicit roomTag, eventKind and injected clock', async () => {
    const relay = new MemoryRelay()
    const transport = await connectNostrMeshTransport({
      relays: ['memory://relay'],
      room: ROOM,
      selfId: 'alice',
      pool: relay.pool(),
      signer: signer('alice'),
      publishGapMs: 0,
      roomTag: 'explicit-room-tag',
      eventKind: 7777,
      now: () => 5_000,
    })

    transport.broadcast({ kind: 'presence', payload: {} })
    await flush()

    expect(relay.published).toHaveLength(1)
    expect(relay.published[0]).toMatchObject({
      kind: 7777,
      tags: [['t', 'explicit-room-tag']],
      created_at: 5,
    })
    transport.stop()
  })
})

describe('connectNostrMeshTransport health', () => {
  it('reports connecting then online, and idle again after stop()', async () => {
    const relay = new MemoryRelay()
    const events: RelayHealth[] = []
    const transport = await connectNostrMeshTransport({
      relays: ['memory://relay'],
      room: ROOM,
      selfId: 'alice',
      pool: relay.pool(),
      signer: signer('alice'),
      publishGapMs: 0,
      health: { onChange: (state) => events.push(state) },
    })

    await flush()
    expect(events).toEqual(['connecting', 'online'])

    transport.stop()
    expect(events).toEqual(['connecting', 'online', 'idle'])
  })

  it('reports unreachable when no relay in the pool ever responds', async () => {
    const events: RelayHealth[] = []
    const transport = await connectNostrMeshTransport({
      relays: ['memory://silent'],
      room: ROOM,
      selfId: 'alice',
      pool: silentPool,
      signer: signer('alice'),
      publishGapMs: 0,
      health: { unreachableAfterMs: 15, onChange: (state) => events.push(state) },
    })

    await flush(40)
    expect(events).toEqual(['connecting', 'unreachable'])

    transport.stop()
    expect(events).toEqual(['connecting', 'unreachable', 'idle'])
  })
})
