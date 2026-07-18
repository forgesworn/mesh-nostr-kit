/** Meatchat's existing NIP-16 ephemeral event kind. Consumers may inject another. */
export const DEFAULT_MESH_EVENT_KIND = 20316

export interface NostrEventTemplate {
  kind: number
  created_at: number
  tags: string[][]
  content: string
}

export interface NostrEventLike {
  kind: number
  tags: string[][]
  content: string
}

export interface FrameEventOptions {
  roomTag: string
  eventKind?: number
}

export function encodeFrameEvent(
  sealedContent: string,
  options: FrameEventOptions & { createdAt: number },
): NostrEventTemplate {
  return {
    kind: options.eventKind ?? DEFAULT_MESH_EVENT_KIND,
    created_at: options.createdAt,
    tags: [['t', options.roomTag]],
    content: sealedContent,
  }
}

export function decodeFrameEvent(
  event: NostrEventLike | null | undefined,
  options: FrameEventOptions,
): string | null {
  if (!event || event.kind !== (options.eventKind ?? DEFAULT_MESH_EVENT_KIND)) return null
  if (!Array.isArray(event.tags)) return null
  const tag = event.tags.find((row) => Array.isArray(row) && row[0] === 't' && typeof row[1] === 'string')
  if (tag?.[1] !== options.roomTag) return null
  if (typeof event.content !== 'string' || event.content.length === 0) return null
  return event.content
}
