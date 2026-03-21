export type PayloadSource =
  | { type: 'list'; values: string[] }
  | { type: 'numbers'; from: number; to: number; step: number }
  | { type: 'bruteforce'; charset: string; minLen: number; maxLen: number }

export function resolvePayloads(source: PayloadSource): string[] {
  if (source.type === 'list') {
    return source.values.filter((v) => v.length > 0 || source.values.length === 1)
  }

  if (source.type === 'numbers') {
    const { from, to, step } = source
    const s = step === 0 ? 1 : Math.abs(step)
    const result: string[] = []
    if (from <= to) {
      for (let i = from; i <= to; i += s) result.push(String(i))
    } else {
      for (let i = from; i >= to; i -= s) result.push(String(i))
    }
    return result
  }

  if (source.type === 'bruteforce') {
    const { charset, minLen, maxLen } = source
    if (!charset) return []
    const result: string[] = []
    function gen(current: string) {
      if (current.length >= minLen) result.push(current)
      if (current.length >= maxLen) return
      for (const ch of charset) gen(current + ch)
    }
    gen('')
    return result
  }

  return []
}

export function countPayloads(source: PayloadSource): number {
  if (source.type === 'list') return source.values.filter((v) => v.length > 0).length
  if (source.type === 'numbers') {
    const { from, to, step } = source
    const s = step === 0 ? 1 : Math.abs(step)
    return Math.floor(Math.abs(to - from) / s) + 1
  }
  if (source.type === 'bruteforce') {
    const { charset, minLen, maxLen } = source
    if (!charset) return 0
    let total = 0
    const n = charset.length
    for (let len = minLen; len <= maxLen; len++) {
      total += Math.pow(n, len)
    }
    return total
  }
  return 0
}
