import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROOM_SEAL_DOMAIN,
  deriveRoomKey,
  deriveRoomTag,
  openRoomFrame,
  sealRoomFrame,
  type SealedFrameBody,
} from './index.js'

describe('deriveRoomTag', () => {
  it('is deterministic for the same room string', async () => {
    const a = await deriveRoomTag('venue:same-room')
    const b = await deriveRoomTag('venue:same-room')
    expect(a).toBe(b)
  })

  it('differs for different room strings', async () => {
    const a = await deriveRoomTag('venue:room-a')
    const b = await deriveRoomTag('venue:room-b')
    expect(a).not.toBe(b)
  })

  it('is a 64-character lowercase hex SHA-256 digest', async () => {
    const tag = await deriveRoomTag('venue:room-format')
    expect(tag).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('deriveRoomKey', () => {
  it('derives a different key when the domain separator changes', async () => {
    const room = 'venue:domain-room'
    const defaultKey = await deriveRoomKey(room)
    const customKey = await deriveRoomKey(room, { domain: 'custom/domain/v1' })
    expect(DEFAULT_ROOM_SEAL_DOMAIN).not.toBe('custom/domain/v1')

    const body: SealedFrameBody = { k: 'channel', p: { ok: true }, f: 'alice' }
    const sealed = await sealRoomFrame(defaultKey, body)
    // Opening with a key derived under a different domain must fail (wrong AES-GCM key).
    expect(await openRoomFrame(customKey, sealed)).toBeNull()
    // The same key that sealed it must still open it correctly.
    expect(await openRoomFrame(defaultKey, sealed)).toEqual(body)
  })

  it('derives a different key for a different room', async () => {
    const keyA = await deriveRoomKey('venue:room-a')
    const keyB = await deriveRoomKey('venue:room-b')
    const body: SealedFrameBody = { k: 'presence', p: null, f: 'alice' }
    const sealed = await sealRoomFrame(keyA, body)
    expect(await openRoomFrame(keyB, sealed)).toBeNull()
  })
})

describe('sealRoomFrame', () => {
  it('produces different ciphertext each time with the default random IV', async () => {
    const key = await deriveRoomKey('venue:random-iv-room')
    const body: SealedFrameBody = { k: 'channel', p: { n: 1 }, f: 'alice' }
    const first = await sealRoomFrame(key, body)
    const second = await sealRoomFrame(key, body)
    expect(first).not.toBe(second)
    expect(await openRoomFrame(key, first)).toEqual(body)
    expect(await openRoomFrame(key, second)).toEqual(body)
  })

  it('rejects when the supplied randomBytes does not return exactly 12 bytes', async () => {
    const key = await deriveRoomKey('venue:bad-iv-room')
    const body: SealedFrameBody = { k: 'channel', p: {}, f: 'alice' }
    await expect(
      sealRoomFrame(key, body, { randomBytes: () => new Uint8Array(8) }),
    ).rejects.toThrow('room seal IV must be 12 bytes')
  })

  it('omits t and i entirely when they are not supplied', async () => {
    const key = await deriveRoomKey('venue:no-optional-fields')
    const body: SealedFrameBody = { k: 'channel', p: { hello: 'world' }, f: 'alice' }
    const sealed = await sealRoomFrame(key, body)
    const opened = await openRoomFrame(key, sealed)
    expect(opened).toEqual(body)
    expect(opened).not.toHaveProperty('t')
    expect(opened).not.toHaveProperty('i')
  })
})

describe('openRoomFrame', () => {
  it('returns null for content that is not valid base64', async () => {
    const key = await deriveRoomKey('venue:invalid-content-room')
    expect(await openRoomFrame(key, 'not valid base64!!!')).toBeNull()
  })

  it('returns null for content shorter than the IV length', async () => {
    const key = await deriveRoomKey('venue:short-content-room')
    // 'AAA=' decodes to a couple of bytes only, well under the 12-byte IV requirement.
    expect(await openRoomFrame(key, 'AAA=')).toBeNull()
  })

  it('returns null when the ciphertext has been tampered with', async () => {
    const key = await deriveRoomKey('venue:tamper-room')
    const body: SealedFrameBody = { k: 'channel', p: { n: 1 }, f: 'alice' }
    const sealed = await sealRoomFrame(key, body)
    const bytes = Uint8Array.from(atob(sealed), (char) => char.charCodeAt(0))
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! + 1) % 256
    const tampered = btoa(String.fromCharCode(...bytes))
    expect(await openRoomFrame(key, tampered)).toBeNull()
  })

  it('returns null when the decrypted body is missing required string fields', async () => {
    const key = await deriveRoomKey('venue:malformed-body-room')
    const malformed = { k: 42, f: 'alice', p: null } as unknown as SealedFrameBody
    const sealed = await sealRoomFrame(key, malformed)
    expect(await openRoomFrame(key, sealed)).toBeNull()
  })

  it('returns null when optional t or i fields have the wrong type', async () => {
    const key = await deriveRoomKey('venue:bad-optional-type-room')
    const malformed = { k: 'channel', f: 'alice', p: null, t: 123 } as unknown as SealedFrameBody
    const sealed = await sealRoomFrame(key, malformed)
    expect(await openRoomFrame(key, sealed)).toBeNull()
  })
})
