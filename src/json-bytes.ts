const U8_KEY = '$u8'

export function jsonSafePayload(value: unknown): unknown {
  if (value instanceof Uint8Array) return { [U8_KEY]: bytesToBase64(value) }
  if (Array.isArray(value)) return value.map(jsonSafePayload)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) out[key] = jsonSafePayload(nested)
    return out
  }
  return value
}

export function revivePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revivePayload)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const marker = record[U8_KEY]
    if (typeof marker === 'string' && Object.keys(record).length === 1) {
      const bytes = base64ToBytes(marker)
      if (bytes !== null) return bytes
    }
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(record)) out[key] = revivePayload(nested)
    return out
  }
  return value
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}
