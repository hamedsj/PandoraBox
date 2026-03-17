import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type InspectorPosition = 'right' | 'bottom'

interface WorkspaceStore {
  inspectorPosition: InspectorPosition
  historyRightSplit: number
  historyBottomSplit: number
  sitemapRightSplit: number
  sitemapBottomSplit: number
  setInspectorPosition: (position: InspectorPosition) => void
  setHistoryRightSplit: (value: number) => void
  setHistoryBottomSplit: (value: number) => void
  setSitemapRightSplit: (value: number) => void
  setSitemapBottomSplit: (value: number) => void
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      inspectorPosition: 'right',
      historyRightSplit: 56,
      historyBottomSplit: 58,
      sitemapRightSplit: 48,
      sitemapBottomSplit: 56,
      setInspectorPosition: (inspectorPosition) => set({ inspectorPosition }),
      setHistoryRightSplit: (historyRightSplit) => set({ historyRightSplit }),
      setHistoryBottomSplit: (historyBottomSplit) => set({ historyBottomSplit }),
      setSitemapRightSplit: (sitemapRightSplit) => set({ sitemapRightSplit }),
      setSitemapBottomSplit: (sitemapBottomSplit) => set({ sitemapBottomSplit }),
    }),
    { name: 'pandora-workspace' }
  )
)
