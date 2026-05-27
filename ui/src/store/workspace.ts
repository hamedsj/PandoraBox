import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type InspectorPosition = 'right' | 'bottom'
export type InspectorTab = 'request' | 'response'
export type BodyViewMode = 'pretty' | 'raw' | 'hex'

interface WorkspaceStore {
  inspectorPosition: InspectorPosition
  // Persisted so the inspector keeps its tab/body mode when you navigate away
  // and back (the inspector unmounts with its host page).
  inspectorTab: InspectorTab
  inspectorBodyMode: BodyViewMode
  historyRightSplit: number
  historyBottomSplit: number
  sitemapRightSplit: number
  sitemapBottomSplit: number
  setInspectorPosition: (position: InspectorPosition) => void
  setInspectorTab: (tab: InspectorTab) => void
  setInspectorBodyMode: (mode: BodyViewMode) => void
  setHistoryRightSplit: (value: number) => void
  setHistoryBottomSplit: (value: number) => void
  setSitemapRightSplit: (value: number) => void
  setSitemapBottomSplit: (value: number) => void
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      inspectorPosition: 'right',
      inspectorTab: 'request',
      inspectorBodyMode: 'pretty',
      historyRightSplit: 56,
      historyBottomSplit: 58,
      sitemapRightSplit: 48,
      sitemapBottomSplit: 56,
      setInspectorPosition: (inspectorPosition) => set({ inspectorPosition }),
      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      setInspectorBodyMode: (inspectorBodyMode) => set({ inspectorBodyMode }),
      setHistoryRightSplit: (historyRightSplit) => set({ historyRightSplit }),
      setHistoryBottomSplit: (historyBottomSplit) => set({ historyBottomSplit }),
      setSitemapRightSplit: (sitemapRightSplit) => set({ sitemapRightSplit }),
      setSitemapBottomSplit: (sitemapBottomSplit) => set({ sitemapBottomSplit }),
    }),
    { name: 'pandora-workspace' }
  )
)
