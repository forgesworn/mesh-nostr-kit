import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, jsonSafePayload, revivePayload } from './index.js'

describe('jsonSafePayload / revivePayload', () => {
  it('passes primitives through unchanged', () => {
    for (const value of [42, 'plain', true, false, null]) {
      expect(jsonSafePayload(value)).toEqual(value)
      expect(revivePayload(value)).toEqual(value)
    }
  })

  it('wraps a top-level Uint8Array as a $u8 marker and reverses it', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const safe = jsonSafePayload(bytes)
    expect(safe).toEqual({ $u8: bytesToBase64(bytes) })
    expect(revivePayload(safe)).toEqual(bytes)
  })

  it('round-trips bytes nested inside arrays and objects at multiple depths', () => {
    const original = {
      plain: 'ok',
      list: [new Uint8Array([9, 9, 9]), { deeper: new Uint8Array([1, 2]) }],
      nested: { a: { b: [new Uint8Array([255]), 'x'] } },
    }
    const safe = jsonSafePayload(original)
    // Every Uint8Array should have become a plain { $u8 } marker (JSON-serialisable).
    expect(JSON.parse(JSON.stringify(safe))).toEqual(safe)
    expect(revivePayload(safe)).toEqual(original)
  })

  it('treats an empty Uint8Array as a valid marker', () => {
    const safe = jsonSafePayload(new Uint8Array(0))
    expect(safe).toEqual({ $u8: '' })
    expect(revivePayload(safe)).toEqual(new Uint8Array(0))
  })

  it('leaves a $u8-only object with an undecodable string as a plain object', () => {
    const value = { $u8: 'not valid base64!!!' }
    expect(revivePayload(value)).toEqual(value)
  })

  it('does not treat $u8 as a bytes marker when other keys are present', () => {
    const value = { $u8: bytesToBase64(new Uint8Array([1, 2, 3])), extra: 'field' }
    expect(revivePayload(value)).toEqual(value)
  })

  it('recurses through plain arrays and objects without a $u8 key', () => {
    const value = { list: [1, 'two', { three: 3 }], flag: false }
    expect(jsonSafePayload(value)).toEqual(value)
    expect(revivePayload(value)).toEqual(value)
  })
})

describe('bytesToBase64 / base64ToBytes', () => {
  it('round-trips an empty byte array', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('')
    expect(base64ToBytes('')).toEqual(new Uint8Array(0))
  })

  it('round-trips a large array spanning multiple internal chunks', () => {
    // bytesToBase64 chunks input in 0x8000-byte windows; exercise several chunk boundaries.
    const bytes = new Uint8Array(200_000)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256
    const encoded = bytesToBase64(bytes)
    const decoded = base64ToBytes(encoded)
    expect(decoded).not.toBeNull()
    expect(decoded).toEqual(bytes)
  })

  it('returns null for base64 with invalid characters', () => {
    expect(base64ToBytes('not valid base64!!!')).toBeNull()
  })

  it('returns null for incorrectly padded base64', () => {
    expect(base64ToBytes('abcde')).toBeNull()
  })
})
