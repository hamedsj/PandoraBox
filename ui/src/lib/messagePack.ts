function ensureAvailable(bytes: Uint8Array, offset: number, count: number) {
  if (offset+count > bytes.length) {
    throw new Error('Unexpected end of MessagePack buffer')
  }
}

function readUint(bytes: Uint8Array, offset: number, size: number): number | bigint {
  ensureAvailable(bytes, offset, size)
  let value = 0n
  for (let i = 0; i < size; i += 1) {
    value = (value << 8n) | BigInt(bytes[offset + i])
  }
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value
}

function readInt(bytes: Uint8Array, offset: number, size: number): number | bigint {
  ensureAvailable(bytes, offset, size)
  let value = 0n
  for (let i = 0; i < size; i += 1) {
    value = (value << 8n) | BigInt(bytes[offset + i])
  }
  const bits = BigInt(size * 8)
  const signBit = 1n << (bits - 1n)
  if (value & signBit) {
    value -= 1n << bits
  }
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value
}

function readFloat32(bytes: Uint8Array, offset: number): number {
  ensureAvailable(bytes, offset, 4)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, false)
}

function readFloat64(bytes: Uint8Array, offset: number): number {
  ensureAvailable(bytes, offset, 8)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, false)
}

function decodeString(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

function toSerializable(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) {
    const base64 = btoa(String.fromCharCode(...value))
    return { type: 'binary', length: value.length, base64 }
  }
  if (Array.isArray(value)) return value.map(toSerializable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toSerializable(v)])
    )
  }
  return value
}

function decodeValue(bytes: Uint8Array, offset: number): [unknown, number] {
  ensureAvailable(bytes, offset, 1)
  const prefix = bytes[offset]
  let next = offset + 1

  if (prefix <= 0x7f) return [prefix, next]
  if (prefix >= 0xe0) return [prefix - 0x100, next]

  if ((prefix & 0xe0) === 0xa0) {
    const length = prefix & 0x1f
    ensureAvailable(bytes, next, length)
    const value = decodeString(bytes.slice(next, next + length))
    return [value, next + length]
  }

  if ((prefix & 0xf0) === 0x90) {
    const length = prefix & 0x0f
    const arr: unknown[] = []
    for (let i = 0; i < length; i += 1) {
      const [value, newOffset] = decodeValue(bytes, next)
      arr.push(value)
      next = newOffset
    }
    return [arr, next]
  }

  if ((prefix & 0xf0) === 0x80) {
    const length = prefix & 0x0f
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < length; i += 1) {
      const [key, keyOffset] = decodeValue(bytes, next)
      const [value, valueOffset] = decodeValue(bytes, keyOffset)
      obj[String(key)] = value
      next = valueOffset
    }
    return [obj, next]
  }

  switch (prefix) {
    case 0xc0:
      return [null, next]
    case 0xc2:
      return [false, next]
    case 0xc3:
      return [true, next]
    case 0xc4: {
      const len = Number(readUint(bytes, next, 1))
      next += 1
      ensureAvailable(bytes, next, len)
      return [bytes.slice(next, next + len), next + len]
    }
    case 0xc5: {
      const len = Number(readUint(bytes, next, 2))
      next += 2
      ensureAvailable(bytes, next, len)
      return [bytes.slice(next, next + len), next + len]
    }
    case 0xc6: {
      const len = Number(readUint(bytes, next, 4))
      next += 4
      ensureAvailable(bytes, next, len)
      return [bytes.slice(next, next + len), next + len]
    }
    case 0xca:
      return [readFloat32(bytes, next), next + 4]
    case 0xcb:
      return [readFloat64(bytes, next), next + 8]
    case 0xcc:
      return [readUint(bytes, next, 1), next + 1]
    case 0xcd:
      return [readUint(bytes, next, 2), next + 2]
    case 0xce:
      return [readUint(bytes, next, 4), next + 4]
    case 0xcf:
      return [readUint(bytes, next, 8), next + 8]
    case 0xd0:
      return [readInt(bytes, next, 1), next + 1]
    case 0xd1:
      return [readInt(bytes, next, 2), next + 2]
    case 0xd2:
      return [readInt(bytes, next, 4), next + 4]
    case 0xd3:
      return [readInt(bytes, next, 8), next + 8]
    case 0xd9: {
      const len = Number(readUint(bytes, next, 1))
      next += 1
      ensureAvailable(bytes, next, len)
      return [decodeString(bytes.slice(next, next + len)), next + len]
    }
    case 0xda: {
      const len = Number(readUint(bytes, next, 2))
      next += 2
      ensureAvailable(bytes, next, len)
      return [decodeString(bytes.slice(next, next + len)), next + len]
    }
    case 0xdb: {
      const len = Number(readUint(bytes, next, 4))
      next += 4
      ensureAvailable(bytes, next, len)
      return [decodeString(bytes.slice(next, next + len)), next + len]
    }
    case 0xdc: {
      const len = Number(readUint(bytes, next, 2))
      next += 2
      const arr: unknown[] = []
      for (let i = 0; i < len; i += 1) {
        const [value, newOffset] = decodeValue(bytes, next)
        arr.push(value)
        next = newOffset
      }
      return [arr, next]
    }
    case 0xdd: {
      const len = Number(readUint(bytes, next, 4))
      next += 4
      const arr: unknown[] = []
      for (let i = 0; i < len; i += 1) {
        const [value, newOffset] = decodeValue(bytes, next)
        arr.push(value)
        next = newOffset
      }
      return [arr, next]
    }
    case 0xde: {
      const len = Number(readUint(bytes, next, 2))
      next += 2
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < len; i += 1) {
        const [key, keyOffset] = decodeValue(bytes, next)
        const [value, valueOffset] = decodeValue(bytes, keyOffset)
        obj[String(key)] = value
        next = valueOffset
      }
      return [obj, next]
    }
    case 0xdf: {
      const len = Number(readUint(bytes, next, 4))
      next += 4
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < len; i += 1) {
        const [key, keyOffset] = decodeValue(bytes, next)
        const [value, valueOffset] = decodeValue(bytes, keyOffset)
        obj[String(key)] = value
        next = valueOffset
      }
      return [obj, next]
    }
    default:
      throw new Error(`Unsupported MessagePack prefix 0x${prefix.toString(16)}`)
  }
}

export function tryDecodeMessagePack(bytes: Uint8Array): string | null {
  const attempts = [0, 1, 2, 3, 4]

  for (const trim of attempts) {
    const source = trim > 0 && bytes.length > trim ? bytes.slice(0, bytes.length - trim) : bytes
    if (source.length === 0) continue

    try {
      let offset = 0
      const values: unknown[] = []
      while (offset < source.length) {
        const [value, next] = decodeValue(source, offset)
        values.push(toSerializable(value))
        offset = next
      }
      if (values.length > 0) {
        return JSON.stringify(values.length === 1 ? values[0] : values, null, 2)
      }
    } catch {
      // try next trim candidate
    }
  }

  return null
}
