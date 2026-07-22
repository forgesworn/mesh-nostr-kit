import { describe, expect, it } from 'vitest'
import { DEFAULT_MESH_EVENT_KIND, decodeFrameEvent, encodeFrameEvent, type NostrEventLike } from './index.js'

describe('encodeFrameEvent', () => {
  it('defaults to DEFAULT_MESH_EVENT_KIND when no eventKind is given', () => {
    const event = encodeFrameEvent('sealed-content', { roomTag: 'room-tag', createdAt: 100 })
    expect(event.kind).toBe(DEFAULT_MESH_EVENT_KIND)
  })

  it('honours an explicit eventKind override', () => {
    const event = encodeFrameEvent('sealed-content', { roomTag: 'room-tag', eventKind: 42, createdAt: 100 })
    expect(event.kind).toBe(42)
  })

  it('builds a single opaque t tag and preserves content/created_at', () => {
    const event = encodeFrameEvent('sealed-content', { roomTag: 'room-tag', createdAt: 1700 })
    expect(event).toEqual({
      kind: DEFAULT_MESH_EVENT_KIND,
      created_at: 1700,
      tags: [['t', 'room-tag']],
      content: 'sealed-content',
    })
  })
})

describe('decodeFrameEvent', () => {
  const options = { roomTag: 'room-tag', eventKind: DEFAULT_MESH_EVENT_KIND }

  it('returns the sealed content on a matching event', () => {
    const event: NostrEventLike = { kind: DEFAULT_MESH_EVENT_KIND, tags: [['t', 'room-tag']], content: 'sealed' }
    expect(decodeFrameEvent(event, options)).toBe('sealed')
  })

  it('accepts the default event kind when eventKind is omitted from options', () => {
    const event: NostrEventLike = { kind: DEFAULT_MESH_EVENT_KIND, tags: [['t', 'room-tag']], content: 'sealed' }
    expect(decodeFrameEvent(event, { roomTag: 'room-tag' })).toBe('sealed')
  })

  it('returns null for a null or undefined event', () => {
    expect(decodeFrameEvent(null, options)).toBeNull()
    expect(decodeFrameEvent(undefined, options)).toBeNull()
  })

  it('returns null when the event kind does not match', () => {
    const event: NostrEventLike = { kind: 1, tags: [['t', 'room-tag']], content: 'sealed' }
    expect(decodeFrameEvent(event, options)).toBeNull()
  })

  it('returns null when tags is not an array', () => {
    const event = { kind: DEFAULT_MESH_EVENT_KIND, tags: 'not-an-array', content: 'sealed' } as unknown as NostrEventLike
    expect(decodeFrameEvent(event, options)).toBeNull()
  })

  it('returns null when there is no t tag', () => {
    const event: NostrEventLike = { kind: DEFAULT_MESH_EVENT_KIND, tags: [['p', 'someone']], content: 'sealed' }
    expect(decodeFrameEvent(event, options)).toBeNull()
  })

  it('returns null when the t tag does not match roomTag', () => {
    const event: NostrEventLike = { kind: DEFAULT_MESH_EVENT_KIND, tags: [['t', 'other-room']], content: 'sealed' }
    expect(decodeFrameEvent(event, options)).toBeNull()
  })

  it('returns null when content is empty', () => {
    const event: NostrEventLike = { kind: DEFAULT_MESH_EVENT_KIND, tags: [['t', 'room-tag']], content: '' }
    expect(decodeFrameEvent(event, options)).toBeNull()
  })

  it('returns null when content is not a string', () => {
    const event = { kind: DEFAULT_MESH_EVENT_KIND, tags: [['t', 'room-tag']], content: 12345 } as unknown as NostrEventLike
    expect(decodeFrameEvent(event, options)).toBeNull()
  })

  it('ignores malformed tag rows when looking for the t tag', () => {
    const event = {
      kind: DEFAULT_MESH_EVENT_KIND,
      tags: [['solo'], null, ['t', 'room-tag']],
      content: 'sealed',
    } as unknown as NostrEventLike
    expect(decodeFrameEvent(event, options)).toBe('sealed')
  })
})
