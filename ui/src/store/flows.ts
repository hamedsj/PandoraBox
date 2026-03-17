import { create } from 'zustand'
import type { Flow } from '@/api/client'
import type { FlowRunState } from '@/lib/flowExecution'

interface FlowsStore {
  flows: Flow[]
  setFlows: (flows: Flow[]) => void
  upsertFlow: (flow: Flow) => void
  deleteFlow: (id: string) => void
  runStates: Record<string, FlowRunState>
  setRunState: (flowId: string, state: FlowRunState) => void
  pendingRequest: import('@/api/client').Request | null
  setPendingRequest: (r: import('@/api/client').Request | null) => void
}

export const useFlowsStore = create<FlowsStore>((set) => ({
  flows: [],
  setFlows: (flows) => set({ flows }),
  upsertFlow: (flow) =>
    set((s) => {
      const idx = s.flows.findIndex((f) => f.id === flow.id)
      if (idx >= 0) {
        const updated = [...s.flows]
        updated[idx] = flow
        return { flows: updated }
      }
      return { flows: [...s.flows, flow] }
    }),
  deleteFlow: (id) => set((s) => ({ flows: s.flows.filter((f) => f.id !== id) })),
  runStates: {},
  setRunState: (flowId, state) =>
    set((s) => ({ runStates: { ...s.runStates, [flowId]: state } })),
  pendingRequest: null,
  setPendingRequest: (r) => set({ pendingRequest: r }),
}))
