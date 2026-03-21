import { create } from 'zustand'
import { buildRawHTTP } from '@/lib/copyRequest'
import { resolvePayloads, type PayloadSource } from '@/lib/intruderPayloads'
import { runAttack, type AttackType, type AttackResult, parseMarkers } from '@/lib/intruderAttack'
import type { Request } from '@/api/client'

export type { AttackType, AttackResult }
export type { PayloadSource }

export interface PayloadConfig {
  source: PayloadSource
}

export interface IntruderSession {
  id: string
  name: string
  raw: string
  requestId: number
  attackType: AttackType
  payloadSets: PayloadConfig[]
  results: AttackResult[]
  status: 'idle' | 'running' | 'paused' | 'done' | 'error'
  progress: { done: number; total: number }
}

interface IntruderState {
  sessions: IntruderSession[]
  activeSessionId: string | null
  intruderAttentionTick: number

  addSession: (req: Request) => string
  removeSession: (id: string) => void
  setActiveSession: (id: string) => void
  updateSession: (id: string, patch: Partial<Omit<IntruderSession, 'id'>>) => void
  startAttack: (id: string) => Promise<void>
  stopAttack: (id: string) => void
  clearResults: (id: string) => void
}

// Keep abort controllers outside Zustand (not serializable)
const abortControllers = new Map<string, AbortController>()

export const useIntruderStore = create<IntruderState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  intruderAttentionTick: 0,

  addSession(req: Request) {
    const raw = buildRawHTTP(req)
    const id = crypto.randomUUID()
    const { sessions } = get()
    const name = `Session ${sessions.length + 1}`
    set((s) => ({
      sessions: [...s.sessions, {
        id, name, raw,
        requestId: req.id,
        attackType: 'sniper',
        payloadSets: [],
        results: [],
        status: 'idle',
        progress: { done: 0, total: 0 },
      }],
      activeSessionId: id,
    }))
    return id
  },

  removeSession(id: string) {
    abortControllers.get(id)?.abort()
    abortControllers.delete(id)
    set((s) => {
      const sessions = s.sessions.filter((sess) => sess.id !== id)
      const activeSessionId =
        s.activeSessionId === id
          ? (sessions[sessions.length - 1]?.id ?? null)
          : s.activeSessionId
      return { sessions, activeSessionId }
    })
  },

  setActiveSession(id: string) {
    set({ activeSessionId: id })
  },

  updateSession(id: string, patch: Partial<Omit<IntruderSession, 'id'>>) {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, ...patch } : sess
      ),
    }))
  },

  async startAttack(id: string) {
    const session = get().sessions.find((s) => s.id === id)
    if (!session) return

    // Resolve payloads
    const markers = parseMarkers(session.raw)
    const payloadSets = markers.map((_, i) => {
      const cfg = session.payloadSets[i]
      if (!cfg) return []
      return resolvePayloads(cfg.source)
    })

    const ac = new AbortController()
    abortControllers.set(id, ac)

    get().updateSession(id, { status: 'running', results: [], progress: { done: 0, total: 0 } })

    try {
      await runAttack({
        raw: session.raw,
        requestId: session.requestId,
        attackType: session.attackType,
        payloadSets,
        concurrency: 5,
        signal: ac.signal,
        onResult: (result) => {
          set((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === id ? { ...sess, results: [...sess.results, result] } : sess
            ),
            intruderAttentionTick: s.intruderAttentionTick + 1,
          }))
        },
        onProgress: (done, total) => {
          get().updateSession(id, { progress: { done, total } })
        },
      })

      if (!ac.signal.aborted) {
        get().updateSession(id, { status: 'done' })
      }
    } catch {
      if (!ac.signal.aborted) {
        get().updateSession(id, { status: 'error' })
      } else {
        get().updateSession(id, { status: 'idle' })
      }
    } finally {
      abortControllers.delete(id)
    }
  },

  stopAttack(id: string) {
    abortControllers.get(id)?.abort()
    get().updateSession(id, { status: 'idle' })
  },

  clearResults(id: string) {
    get().updateSession(id, { results: [], progress: { done: 0, total: 0 }, status: 'idle' })
  },
}))
