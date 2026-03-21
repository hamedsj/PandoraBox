import { api } from '@/api/client'

export type AttackType = 'sniper' | 'battering_ram' | 'pitchfork' | 'cluster_bomb'

export interface AttackResult {
  index: number
  payloads: string[]      // one per marker position
  status: number | null
  length: number | null
  time: number            // ms
  error?: string
}

/** Find all §...§ spans in raw HTTP and return their positions + default values */
export function parseMarkers(raw: string): { start: number; end: number; defaultValue: string }[] {
  const markers: { start: number; end: number; defaultValue: string }[] = []
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '§') {
      const start = i
      const close = raw.indexOf('§', i + 1)
      if (close === -1) { i++; continue }
      markers.push({ start, end: close, defaultValue: raw.slice(start + 1, close) })
      i = close + 1
    } else {
      i++
    }
  }
  return markers
}

/** Replace §...§ markers in raw string with given values (one per marker) */
function applyPayloads(raw: string, markers: ReturnType<typeof parseMarkers>, values: string[]): string {
  // Process in reverse order to preserve offsets
  let result = raw
  let offset = 0
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i]
    const val = values[i] ?? m.defaultValue
    result = result.slice(0, m.start + offset) + val + result.slice(m.end + 1 + offset)
    offset += val.length - (m.end - m.start + 1)
  }
  return result
}

/** Build the list of [markerValues] tuples for each request variant based on attack type */
function buildVariants(
  attackType: AttackType,
  markerCount: number,
  payloadSets: string[][],
): string[][] {
  if (markerCount === 0) return [[]]

  const sets = payloadSets.slice(0, markerCount)
  // Fill missing sets with empty array → use marker default
  while (sets.length < markerCount) sets.push([])

  if (attackType === 'sniper') {
    const first = sets[0] ?? []
    const variants: string[][] = []
    for (let m = 0; m < markerCount; m++) {
      const payloads = sets[m] ?? first
      for (const payload of payloads) {
        // All markers use default except position m
        const row = Array(markerCount).fill('')
        row[m] = payload
        variants.push(row)
      }
    }
    return variants
  }

  if (attackType === 'battering_ram') {
    const first = sets[0] ?? []
    return first.map((payload) => Array(markerCount).fill(payload))
  }

  if (attackType === 'pitchfork') {
    const len = Math.min(...sets.map((s) => s.length))
    const variants: string[][] = []
    for (let i = 0; i < len; i++) {
      variants.push(sets.map((s) => s[i] ?? ''))
    }
    return variants
  }

  if (attackType === 'cluster_bomb') {
    // Cartesian product
    let result: string[][] = [[]]
    for (const set of sets) {
      const next: string[][] = []
      for (const existing of result) {
        for (const val of (set.length > 0 ? set : [''])) {
          next.push([...existing, val])
        }
      }
      result = next
    }
    return result
  }

  return []
}

async function sendVariant(
  raw: string,
  requestId: number,
  signal: AbortSignal,
): Promise<{ status: number | null; length: number | null; time: number; error?: string }> {
  const start = performance.now()
  try {
    // base64-encode: handle unicode chars correctly
    const encoded = btoa(unescape(encodeURIComponent(raw)))
    const replay = await api.replay.create({ request_id: requestId, raw: encoded })
    const time = Math.round(performance.now() - start)
    const status = replay.response?.status_code ?? null
    let length: number | null = null
    if (replay.response?.body != null) {
      if (typeof replay.response.body === 'string') {
        try { length = atob(replay.response.body).length } catch { length = replay.response.body.length }
      } else if (Array.isArray(replay.response.body)) {
        length = replay.response.body.length
      }
    }
    return { status, length, time }
  } catch (err) {
    if (signal.aborted) throw err
    return {
      status: null,
      length: null,
      time: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function runAttack(opts: {
  raw: string
  requestId: number
  attackType: AttackType
  payloadSets: string[][]
  concurrency: number
  signal: AbortSignal
  onResult: (r: AttackResult) => void
  onProgress: (done: number, total: number) => void
}): Promise<void> {
  const { raw, requestId, attackType, payloadSets, concurrency, signal, onResult, onProgress } = opts

  const markers = parseMarkers(raw)
  const variants = buildVariants(attackType, markers.length, payloadSets)
  const total = variants.length

  let done = 0
  let index = 0

  // Semaphore: run up to `concurrency` requests at once
  const running = new Set<Promise<void>>()

  async function runOne(variantIndex: number, payloadValues: string[]): Promise<void> {
    const variant = markers.length > 0 ? applyPayloads(raw, markers, payloadValues) : raw
    const { status, length, time, error } = await sendVariant(variant, requestId, signal)
    done++
    onProgress(done, total)
    onResult({ index: variantIndex, payloads: payloadValues, status, length, time, error })
  }

  for (const payloadValues of variants) {
    if (signal.aborted) break

    const p = runOne(index++, payloadValues).then(() => { running.delete(p) })
    running.add(p)

    if (running.size >= concurrency) {
      await Promise.race(running)
    }
  }

  await Promise.allSettled(running)
}

export function countVariants(
  attackType: AttackType,
  markerCount: number,
  payloadSets: string[][],
): number {
  if (markerCount === 0) return 1
  const sets = payloadSets.slice(0, markerCount)
  while (sets.length < markerCount) sets.push([])

  if (attackType === 'sniper') {
    return sets.reduce((sum, s, i) => sum + (s.length > 0 ? s.length : (payloadSets[0]?.length ?? 0)), 0)
  }
  if (attackType === 'battering_ram') return sets[0]?.length ?? 0
  if (attackType === 'pitchfork') return Math.min(...sets.map((s) => s.length))
  if (attackType === 'cluster_bomb') return sets.reduce((prod, s) => prod * (s.length || 1), 1)
  return 0
}
