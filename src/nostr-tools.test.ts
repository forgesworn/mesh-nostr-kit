import { getPublicKey, generateSecretKey, verifyEvent } from 'nostr-tools/pure'
import { describe, expect, it } from 'vitest'
import { createEphemeralNostrSigner, createNostrToolsPool, type NostrEventTemplate } from './index.js'

// nostr-tools' finalizeEvent mutates its input template in place and returns that same
// reference, so every call in these tests needs its own fresh object -- sharing one template
// across sign() calls would make "distinct" signed events alias the same underlying object.
function makeTemplate(overrides: Partial<NostrEventTemplate> = {}): NostrEventTemplate {
  return {
    kind: 20316,
    created_at: 1_700_000_000,
    tags: [['t', 'room-tag']],
    content: 'sealed-content',
    ...overrides,
  }
}

describe('createEphemeralNostrSigner', () => {
  it('signs a template into a real, independently verifiable Nostr event', async () => {
    const signer = createEphemeralNostrSigner()
    const template = makeTemplate()
    const signed = await signer.sign(template)

    expect(signed.kind).toBe(template.kind)
    expect(signed.created_at).toBe(template.created_at)
    expect(signed.tags).toEqual(template.tags)
    expect(signed.content).toBe(template.content)
    expect(signed.id).toMatch(/^[0-9a-f]{64}$/)
    expect(signed.pubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(verifyEvent(signed)).toBe(true)
  })

  it('uses the supplied secret key deterministically for the pubkey', async () => {
    const secretKey = generateSecretKey()
    const signer = createEphemeralNostrSigner(secretKey)
    const signed = await signer.sign(makeTemplate())
    expect(signed.pubkey).toBe(getPublicKey(secretKey))
  })

  it('produces distinct ids/signatures for distinct content from the same signer', async () => {
    const secretKey = generateSecretKey()
    const signer = createEphemeralNostrSigner(secretKey)
    const first = await signer.sign(makeTemplate())
    const second = await signer.sign(makeTemplate({ content: 'different-content' }))

    expect(first.id).not.toBe(second.id)
    expect(first.sig).not.toBe(second.sig)
    expect(first.pubkey).toBe(second.pubkey)
    expect(verifyEvent(first)).toBe(true)
    expect(verifyEvent(second)).toBe(true)
  })

  it('defaults to a fresh secret key each call when none is supplied', async () => {
    const signedA = await createEphemeralNostrSigner().sign(makeTemplate())
    const signedB = await createEphemeralNostrSigner().sign(makeTemplate())
    expect(signedA.pubkey).not.toBe(signedB.pubkey)
  })
})

describe('createNostrToolsPool', () => {
  it('returns a MeshPool-shaped object without making any network calls', () => {
    const pool = createNostrToolsPool()
    expect(typeof pool.subscribeMany).toBe('function')
    expect(typeof pool.publish).toBe('function')
    expect(typeof pool.close).toBe('function')
  })
})
