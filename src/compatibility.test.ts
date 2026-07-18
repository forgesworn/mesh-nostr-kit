import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { MeshFrame } from 'mesh-kit'
import {
  connectNostrMeshTransport,
  decodeFrameEvent,
  deriveRoomKey,
  deriveRoomTag,
  encodeFrameEvent,
  jsonSafePayload,
  openRoomFrame,
  revivePayload,
  sealRoomFrame,
  type MeshPool,
  type NostrEventSigner,
  type NostrSignedEvent,
} from './index.js'

interface CompatibilityVector {
  eventKind: number
  room: string
  roomTag: string
  body: { k: string; p: unknown; f: string; t: string; i: string }
  fixedIvHex: string
  sealed: string
  event: { kind: number; created_at: number; tags: string[][] }
  jsonBytes: { inputHex: string; markerBase64: string }
  pacing: { submittedKinds: string[]; publishedKinds: string[] }
  reconnect: { silenceMs: number; tickMs: number; minimumSubscriptions: number }
}

const vector = JSON.parse(
  readFileSync(new URL('../compatibility-vectors/meatchat-nostr-v1.json', import.meta.url), 'utf8'),
) as CompatibilityVector
const flush = (ms = 15): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
}

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
  subscriptionCount = 0

  pool(): MeshPool {
    const owned = new Set<(typeof this.subscriptions extends Set<infer T> ? T : never)>()
    return {
      subscribeMany: (_relays, filter, params) => {
        this.subscriptionCount += 1
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

describe('Meatchat Nostr compatibility vectors', () => {
  it('freezes event, room tag and room-seal bytes', async () => {
    expect(await deriveRoomTag(vector.room)).toBe(vector.roomTag)
    const key = await deriveRoomKey(vector.room)
    const sealed = await sealRoomFrame(key, vector.body, {
      randomBytes: () => hexBytes(vector.fixedIvHex),
    })
    expect(sealed).toBe(vector.sealed)
    expect(await openRoomFrame(key, sealed)).toEqual(vector.body)

    const event = encodeFrameEvent(sealed, {
      roomTag: vector.event.tags[0]![1]!,
      eventKind: vector.eventKind,
      createdAt: vector.event.created_at,
    })
    expect(event).toEqual({ ...vector.event, content: vector.sealed })
    expect(decodeFrameEvent(event, {
      roomTag: vector.event.tags[0]![1]!,
      eventKind: vector.eventKind,
    })).toBe(vector.sealed)
  })

  it('freezes byte-safe recursive JSON markers', () => {
    const bytes = hexBytes(vector.jsonBytes.inputHex)
    const safe = jsonSafePayload({ nested: [bytes], plain: 'ok' })
    expect(safe).toEqual({
      nested: [{ $u8: vector.jsonBytes.markerBase64 }],
      plain: 'ok',
    })
    expect(revivePayload(safe)).toEqual({ nested: [bytes], plain: 'ok' })
  })
})

describe('Nostr mesh transport', () => {
  it('interoperates through an in-memory relay with nested bytes intact', async () => {
    const relay = new MemoryRelay()
    const alice = await connectNostrMeshTransport({
      relays: ['memory://relay'],
      room: vector.room,
      selfId: 'alice',
      pool: relay.pool(),
      signer: signer('alice'),
      publishGapMs: 0,
    })
    const bob = await connectNostrMeshTransport({
      relays: ['memory://relay'],
      room: vector.room,
      selfId: 'bob',
      pool: relay.pool(),
      signer: signer('bob'),
      publishGapMs: 0,
    })
    const received: MeshFrame[] = []
    bob.subscribe((frame) => received.push(frame))

    alice.send('bob', {
      kind: 'channel',
      payload: { bytes: new Uint8Array([0, 127, 255]) },
    })
    await flush()
    expect(received).toEqual([{
      kind: 'channel',
      payload: { bytes: new Uint8Array([0, 127, 255]) },
      from: 'alice',
    }])
    alice.stop()
    bob.stop()
  })

  it('preserves FIFO within priorities while control overtakes queued bulk', async () => {
    const relay = new MemoryRelay()
    const transport = await connectNostrMeshTransport({
      relays: ['memory://relay'],
      room: vector.room,
      selfId: 'alice',
      pool: relay.pool(),
      signer: signer('paced'),
      publishGapMs: 15,
      priority: (frame) => frame.kind === 'channel' ? 'bulk' : 'control',
    })
    for (const [index, kind] of vector.pacing.submittedKinds.entries()) {
      transport.broadcast({ kind, payload: { index } })
    }
    await flush(120)

    const key = await deriveRoomKey(vector.room)
    const publishedKinds: string[] = []
    for (const event of relay.published) {
      const body = await openRoomFrame(key, event.content)
      publishedKinds.push(body!.k)
    }
    expect(publishedKinds).toEqual(vector.pacing.publishedKinds)
    transport.stop()
  })

  it('reissues a silent subscription and stops the watchdog cleanly', async () => {
    const relay = new MemoryRelay()
    const transport = await connectNostrMeshTransport({
      relays: ['memory://silent'],
      room: vector.room,
      selfId: 'alice',
      pool: relay.pool(),
      signer: signer('watchdog'),
      publishGapMs: 0,
      watchdog: vector.reconnect,
    })
    await flush(90)
    expect(relay.subscriptionCount).toBeGreaterThanOrEqual(vector.reconnect.minimumSubscriptions)
    transport.stop()
    const stoppedAt = relay.subscriptionCount
    await flush(60)
    expect(relay.subscriptionCount).toBe(stoppedAt)
  })
})
