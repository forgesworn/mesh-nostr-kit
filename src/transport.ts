import { SeenFrameIds, type MeshFrame, type WideBridgeLane } from 'mesh-kit'
import { decodeFrameEvent, encodeFrameEvent, DEFAULT_MESH_EVENT_KIND, type NostrEventTemplate } from './event.js'
import { jsonSafePayload, revivePayload } from './json-bytes.js'
import {
  deriveRoomKey,
  deriveRoomTag,
  openRoomFrame,
  sealRoomFrame,
  type RoomKeyOptions,
} from './room-seal.js'

export interface NostrSignedEvent {
  id: string
  kind: number
  tags: string[][]
  content: string
  created_at: number
  pubkey: string
  sig: string
}

export interface MeshPool {
  subscribeMany(
    relays: string[],
    filter: Record<string, unknown>,
    params: { onevent: (event: NostrSignedEvent) => void; oneose?: () => void },
  ): { close(): void }
  publish(relays: string[], event: NostrSignedEvent): unknown
  close(relays: string[]): void
}

export interface NostrEventSigner {
  sign(template: NostrEventTemplate): NostrSignedEvent | Promise<NostrSignedEvent>
}

export type RelayHealth = 'idle' | 'connecting' | 'online' | 'unreachable'

export interface NostrMeshTransportOptions extends RoomKeyOptions {
  relays: readonly string[]
  room: string
  selfId: string
  pool: MeshPool
  signer: NostrEventSigner
  /** NIP-16 event kind; defaults to the extracted Meatchat value 20316. */
  eventKind?: number
  now?: () => number
  roomTag?: string
  publishGapMs?: number
  /** Consumer-owned priority policy; FIFO is preserved inside each class. */
  priority?: (frame: MeshFrame) => 'control' | 'bulk'
  watchdog?: { silenceMs?: number; tickMs?: number }
  health?: { unreachableAfterMs?: number; onChange(state: RelayHealth): void }
  bridgeDedup?: { capacity?: number; ttlMs?: number; seen?: SeenFrameIds }
}

export interface RunningNostrMeshTransport extends WideBridgeLane {
  stop(): void
}

const DEFAULT_PUBLISH_GAP_MS = 900
const DEFAULT_WATCHDOG_SILENCE_MS = 45_000
const DEFAULT_WATCHDOG_TICK_MS = 15_000
const DEFAULT_BRIDGE_DEDUP_CAPACITY = 4096
const DEFAULT_BRIDGE_DEDUP_TTL_MS = 20_000

/** Resolve the strictest relay gap from consumer-supplied policy values. */
export function publishGapForRelays(
  relays: readonly string[],
  options: { defaultGapMs: number; byRelay?: Readonly<Record<string, number>> },
): number {
  if (relays.length === 0) return options.defaultGapMs
  let gap = 0
  for (const relay of relays) {
    gap = Math.max(gap, options.byRelay?.[relay.replace(/\/+$/, '')] ?? options.defaultGapMs)
  }
  return gap
}

/** Connect an ordered, sealed MeshTransport over an injected Nostr pool and signer. */
export async function connectNostrMeshTransport(
  options: NostrMeshTransportOptions,
): Promise<RunningNostrMeshTransport> {
  const relays = [...options.relays]
  const now = options.now ?? (() => Date.now())
  const eventKind = options.eventKind ?? DEFAULT_MESH_EVENT_KIND
  const roomTag = options.roomTag ?? await deriveRoomTag(options.room)
  const roomKey = await deriveRoomKey(options.room, { domain: options.domain })
  const publishGapMs = options.publishGapMs ?? DEFAULT_PUBLISH_GAP_MS
  const priority = options.priority ?? (() => 'control' as const)
  const handlers = new Set<(frame: MeshFrame) => void>()
  const taps = new Set<(frame: MeshFrame, to?: string, id?: string) => void>()
  const seenEvents = new Set<string>()
  const seenBridgeIds = options.bridgeDedup?.seen ?? new SeenFrameIds({
    capacity: options.bridgeDedup?.capacity ?? DEFAULT_BRIDGE_DEDUP_CAPACITY,
    ttlMs: options.bridgeDedup?.ttlMs ?? DEFAULT_BRIDGE_DEDUP_TTL_MS,
    now,
  })
  let outboundChain: Promise<void> = Promise.resolve()
  let inboundChain: Promise<void> = Promise.resolve()
  let stopped = false

  let healthState: RelayHealth = 'idle'
  const setHealth = (state: RelayHealth): void => {
    if (healthState === state) return
    healthState = state
    options.health?.onChange(state)
  }
  setHealth('connecting')
  let sawRelay = false
  const markOnline = (): void => {
    sawRelay = true
    setHealth('online')
  }
  const healthTimer = setTimeout(() => {
    if (!sawRelay) setHealth('unreachable')
  }, options.health?.unreachableAfterMs ?? 10_000)

  const controlQueue: NostrSignedEvent[] = []
  const bulkQueue: NostrSignedEvent[] = []
  let drainTimer: ReturnType<typeof setTimeout> | undefined
  const sendNow = (event: NostrSignedEvent): void => {
    const results = options.pool.publish(relays, event)
    if (Array.isArray(results)) {
      for (const result of results) void Promise.resolve(result).catch(() => {})
    }
  }
  const scheduleDrain = (): void => {
    if (stopped || drainTimer !== undefined || (controlQueue.length === 0 && bulkQueue.length === 0)) return
    drainTimer = setTimeout(() => {
      drainTimer = undefined
      const next = controlQueue.shift() ?? bulkQueue.shift()
      if (next) sendNow(next)
      scheduleDrain()
    }, publishGapMs)
  }

  let lastEventAt = now()
  const openSubscription = (): { close(): void } => options.pool.subscribeMany(
    relays,
    { kinds: [eventKind], '#t': [roomTag] },
    {
      onevent: (event) => {
        lastEventAt = now()
        markOnline()
        if (seenEvents.has(event.id)) return
        seenEvents.add(event.id)
        const sealed = decodeFrameEvent(event, { roomTag, eventKind })
        if (sealed === null) return
        inboundChain = inboundChain.then(async () => {
          const body = await openRoomFrame(roomKey, sealed)
          if (body === null) return
          if (body.i !== undefined && !seenBridgeIds.check(body.i)) return
          if (body.f === options.selfId) return
          const frame: MeshFrame = { kind: body.k, payload: revivePayload(body.p), from: body.f }
          for (const tap of [...taps]) tap(frame, body.t, body.i)
          if (body.t !== undefined && body.t !== options.selfId) return
          for (const handler of [...handlers]) handler(frame)
        })
      },
      oneose: () => {
        lastEventAt = now()
        markOnline()
      },
    },
  )
  let subscription = openSubscription()

  const silenceMs = options.watchdog?.silenceMs ?? DEFAULT_WATCHDOG_SILENCE_MS
  const watchdogTimer = setInterval(() => {
    if (now() - lastEventAt <= silenceMs) return
    try {
      subscription.close()
    } catch {
      // best effort
    }
    if (healthState === 'online') setHealth('connecting')
    subscription = openSubscription()
    lastEventAt = now()
  }, options.watchdog?.tickMs ?? DEFAULT_WATCHDOG_TICK_MS)

  const publish = (frame: MeshFrame, route: { from: string; to?: string; id?: string }): void => {
    outboundChain = outboundChain.then(async () => {
      if (stopped) return
      const sealed = await sealRoomFrame(roomKey, {
        k: frame.kind,
        p: jsonSafePayload(frame.payload),
        f: route.from,
        ...(route.to !== undefined ? { t: route.to } : {}),
        ...(route.id !== undefined ? { i: route.id } : {}),
      })
      const template = encodeFrameEvent(sealed, {
        roomTag,
        eventKind,
        createdAt: Math.floor(now() / 1000),
      })
      const signed = await options.signer.sign(template)
      if (route.from !== options.selfId) seenEvents.add(signed.id)
      if (publishGapMs <= 0) {
        sendNow(signed)
        return
      }
      ;(priority(frame) === 'bulk' ? bulkQueue : controlQueue).push(signed)
      scheduleDrain()
    })
  }

  return {
    broadcast: (frame) => publish(frame, { from: options.selfId }),
    send: (peer, frame) => publish(frame, { from: options.selfId, to: peer }),
    publishAs: (from, frame, route) => publish(frame, { from, to: route.to, id: route.id }),
    subscribe: (handler) => {
      handlers.add(handler)
      return { close: () => void handlers.delete(handler) }
    },
    tap: (handler) => {
      taps.add(handler)
      return { close: () => void taps.delete(handler) }
    },
    stop: () => {
      stopped = true
      clearTimeout(healthTimer)
      clearInterval(watchdogTimer)
      setHealth('idle')
      if (drainTimer !== undefined) clearTimeout(drainTimer)
      controlQueue.length = 0
      bulkQueue.length = 0
      handlers.clear()
      taps.clear()
      subscription.close()
      try {
        options.pool.close(relays)
      } catch {
        // best effort
      }
    },
  }
}
