import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Request } from '@/api/client'
import { getRawRequestText } from '@/lib/rawHttp'

// One entry in the Replay/Repeater queue. Self-contained: it carries the source
// request snapshot (for the label and "in replay?" checks), the current
// editable raw packet, the chosen transport scheme, and the per-entry packet
// history. Nothing here depends on a server row, so the queue survives reloads.
export interface ReplayQueueItem {
  queueId: number
  request: Request
  packet: string
  scheme: string // "http" | "https"
  history: { entries: string[]; index: number }
}

const MAX_QUEUE = 100
const MAX_HISTORY = 25

function schemeOf(req: Request): string {
  return req.scheme === 'https' ? 'https' : 'http'
}

function newItem(queueId: number, req: Request): ReplayQueueItem {
  const packet = getRawRequestText(req)
  return {
    queueId,
    request: req,
    packet,
    scheme: schemeOf(req),
    history: { entries: [packet], index: 0 },
  }
}

interface ReplayQueueState {
  // Active project's queue (derived from byProject[activeProject]).
  replayQueue: ReplayQueueItem[]
  // Persisted per-project queues + the running id counter.
  byProject: Record<string, ReplayQueueItem[]>
  activeProject: string
  nextId: number
  attentionTick: number

  setActiveProject: (path: string) => void
  addToReplay: (req: Request) => void
  removeFromReplay: (queueId: number) => void
  removeRequestFromReplay: (requestId: number) => void
  duplicateReplayItem: (queueId: number) => void
  clearReplay: () => void

  updatePacket: (queueId: number, packet: string) => void
  setScheme: (queueId: number, scheme: string) => void
  pushHistory: (queueId: number, packet: string) => void
  setHistoryIndex: (queueId: number, index: number) => void
}

export const useReplayQueueStore = create<ReplayQueueState>()(
  persist(
    (set, get) => {
      // Write `items` back to both the active array and the per-project map so
      // persistence always reflects the latest queue.
      const commit = (items: ReplayQueueItem[]) => {
        const { activeProject, byProject } = get()
        set({
          replayQueue: items,
          byProject: { ...byProject, [activeProject]: items },
        })
      }
      const mapItems = (fn: (it: ReplayQueueItem) => ReplayQueueItem) =>
        commit(get().replayQueue.map(fn))

      return {
        replayQueue: [],
        byProject: {},
        activeProject: '',
        nextId: 1,
        attentionTick: 0,

        setActiveProject: (path) => {
          const { activeProject, byProject } = get()
          if (path === activeProject) return
          set({
            activeProject: path,
            replayQueue: byProject[path] ?? [],
          })
        },

        addToReplay: (req) =>
          set((state) => {
            // Dedup by the source request id — re-adding bumps attention only.
            if (state.replayQueue.some((e) => e.request.id === req.id)) {
              return { attentionTick: state.attentionTick + 1 }
            }
            const item = newItem(state.nextId, req)
            const items = [item, ...state.replayQueue].slice(0, MAX_QUEUE)
            return {
              replayQueue: items,
              byProject: { ...state.byProject, [state.activeProject]: items },
              nextId: state.nextId + 1,
              attentionTick: state.attentionTick + 1,
            }
          }),

        removeFromReplay: (queueId) =>
          commit(get().replayQueue.filter((e) => e.queueId !== queueId)),

        removeRequestFromReplay: (requestId) =>
          commit(get().replayQueue.filter((e) => e.request.id !== requestId)),

        duplicateReplayItem: (queueId) =>
          set((state) => {
            const src = state.replayQueue.find((e) => e.queueId === queueId)
            if (!src) return state
            const clone: ReplayQueueItem = {
              ...src,
              queueId: state.nextId,
              history: { entries: [...src.history.entries], index: src.history.index },
            }
            const items = [clone, ...state.replayQueue].slice(0, MAX_QUEUE)
            return {
              replayQueue: items,
              byProject: { ...state.byProject, [state.activeProject]: items },
              nextId: state.nextId + 1,
              attentionTick: state.attentionTick + 1,
            }
          }),

        clearReplay: () => commit([]),

        updatePacket: (queueId, packet) =>
          mapItems((it) => (it.queueId === queueId ? { ...it, packet } : it)),

        setScheme: (queueId, scheme) =>
          mapItems((it) => (it.queueId === queueId ? { ...it, scheme } : it)),

        // Record a successfully-sent packet in the per-entry history (forward
        // entries past the current index are discarded, like an undo stack).
        pushHistory: (queueId, packet) =>
          mapItems((it) => {
            if (it.queueId !== queueId) return it
            const visible = it.history.entries.slice(0, it.history.index + 1)
            const last = visible[visible.length - 1]
            const entries = (last === packet ? visible : [...visible, packet]).slice(-MAX_HISTORY)
            return { ...it, packet, history: { entries, index: entries.length - 1 } }
          }),

        setHistoryIndex: (queueId, index) =>
          mapItems((it) => {
            if (it.queueId !== queueId) return it
            if (index < 0 || index >= it.history.entries.length) return it
            return { ...it, packet: it.history.entries[index], history: { ...it.history, index } }
          }),
      }
    },
    {
      name: 'pandora-replay-queue',
      // Only the per-project map + id counter are persisted. The active array is
      // re-derived via setActiveProject after rehydration.
      partialize: (s) => ({ byProject: s.byProject, nextId: s.nextId }),
    },
  ),
)
