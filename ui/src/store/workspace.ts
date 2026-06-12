import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type InspectorPosition = 'right' | 'bottom'
export type BodyViewMode = 'pretty' | 'raw' | 'hex'

interface WorkspaceStore {
  inspectorPosition: InspectorPosition
  inspectorBodyMode: BodyViewMode
  /** Split ratio (%) for the request pane in the dual-pane inspector. */
  inspectorMessageSplit: number
  historyRightSplit: number
  historyBottomSplit: number
  sitemapRightSplit: number
  sitemapBottomSplit: number
  setInspectorPosition: (position: InspectorPosition) => void
  setInspectorBodyMode: (mode: BodyViewMode) => void
  setInspectorMessageSplit: (value: number) => void
  setHistoryRightSplit: (value: number) => void
  setHistoryBottomSplit: (value: number) => void
  setSitemapRightSplit: (value: number) => void
  setSitemapBottomSplit: (value: number) => void
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      inspectorPosition: 'right',
      inspectorBodyMode: 'pretty',
      inspectorMessageSplit: 50,
      historyRightSplit: 56,
      historyBottomSplit: 58,
      sitemapRightSplit: 48,
      sitemapBottomSplit: 56,
      setInspectorPosition: (inspectorPosition) => set({ inspectorPosition }),
      setInspectorBodyMode: (inspectorBodyMode) => set({ inspectorBodyMode }),
      setInspectorMessageSplit: (inspectorMessageSplit) => set({ inspectorMessageSplit }),
      setHistoryRightSplit: (historyRightSplit) => set({ historyRightSplit }),
      setHistoryBottomSplit: (historyBottomSplit) => set({ historyBottomSplit }),
      setSitemapRightSplit: (sitemapRightSplit) => set({ sitemapRightSplit }),
      setSitemapBottomSplit: (sitemapBottomSplit) => set({ sitemapBottomSplit }),
    }),
    { name: 'pandora-workspace' }
  )
)
