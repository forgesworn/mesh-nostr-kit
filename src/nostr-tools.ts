import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import type { MeshPool, NostrEventSigner, NostrSignedEvent } from './transport.js'

/** Create the standard nostr-tools pool behind the injectable MeshPool port. */
export function createNostrToolsPool(): MeshPool {
  return new SimplePool() as unknown as MeshPool
}

/** Create a throwaway session signer, matching Meatchat's original wrapper identity. */
export function createEphemeralNostrSigner(secretKey = generateSecretKey()): NostrEventSigner {
  return {
    sign: (template) => finalizeEvent(template, secretKey) as unknown as NostrSignedEvent,
  }
}
