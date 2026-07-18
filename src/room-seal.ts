import { base64ToBytes, bytesToBase64 } from './json-bytes.js'

/** Exact domain separator used by the extracted Meatchat transport. */
export const DEFAULT_ROOM_SEAL_DOMAIN = 'meatchat/room-seal/v1'
const SEAL_INFO = 'aes-256-gcm'
const IV_BYTES = 12

export interface SealedFrameBody {
  k: string
  p: unknown
  f: string
  t?: string
  i?: string
}

export interface RoomKeyOptions {
  /** HKDF salt/domain separator. Change only for a deliberately incompatible rail. */
  domain?: string
}

export async function deriveRoomKey(room: string, options: RoomKeyOptions = {}): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const material = await crypto.subtle.importKey('raw', encoder.encode(room), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(options.domain ?? DEFAULT_ROOM_SEAL_DOMAIN),
      info: encoder.encode(SEAL_INFO),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function deriveRoomTag(room: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(room))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface SealOptions {
  randomBytes?: (length: number) => Uint8Array
}

export async function sealRoomFrame(
  key: CryptoKey,
  body: SealedFrameBody,
  options: SealOptions = {},
): Promise<string> {
  const randomBytes = options.randomBytes ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length)))
  const suppliedIv = randomBytes(IV_BYTES)
  if (suppliedIv.length !== IV_BYTES) throw new Error(`room seal IV must be ${IV_BYTES} bytes`)
  const iv = new Uint8Array(IV_BYTES)
  iv.set(suppliedIv)
  const plaintext = new TextEncoder().encode(JSON.stringify(body))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  const sealed = new Uint8Array(iv.length + ciphertext.length)
  sealed.set(iv)
  sealed.set(ciphertext, iv.length)
  return bytesToBase64(sealed)
}

export async function openRoomFrame(key: CryptoKey, content: string): Promise<SealedFrameBody | null> {
  try {
    const bytes = base64ToBytes(content)
    if (bytes === null || bytes.length <= IV_BYTES) return null
    const iv = new Uint8Array(bytes.subarray(0, IV_BYTES))
    const ciphertext = new Uint8Array(bytes.subarray(IV_BYTES))
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    const value = JSON.parse(new TextDecoder().decode(plaintext)) as unknown
    if (value === null || typeof value !== 'object') return null
    const body = value as Record<string, unknown>
    if (typeof body['k'] !== 'string' || typeof body['f'] !== 'string') return null
    if (body['t'] !== undefined && typeof body['t'] !== 'string') return null
    if (body['i'] !== undefined && typeof body['i'] !== 'string') return null
    return {
      k: body['k'],
      p: body['p'],
      f: body['f'],
      ...(body['t'] !== undefined ? { t: body['t'] as string } : {}),
      ...(body['i'] !== undefined ? { i: body['i'] as string } : {}),
    }
  } catch {
    return null
  }
}
