import { useState } from 'react'
import { RequestTable, type HistoryTab } from '@/components/history/RequestTable'
import { RequestInspector } from '@/components/inspector/RequestInspector'
import { WSConnectionInspector } from '@/components/inspector/WSConnectionInspector'
import { useProxyStore } from '@/store/proxy'
import { useWorkspaceStore } from '@/store/workspace'
import { RequestWorkspaceLayout } from '@/components/layout/RequestWorkspaceLayout'

export function HistoryPage() {
  const [historyTab, setHistoryTab] = useState<HistoryTab>('http')
  const selectedId = useProxyStore((s) => s.selectedRequestId)
  const setSelectedRequestId = useProxyStore((s) => s.setSelectedRequestId)
  const inspectorPosition = useWorkspaceStore((state) => state.inspectorPosition)
  const historyRightSplit = useWorkspaceStore((state) => state.historyRightSplit)
  const historyBottomSplit = useWorkspaceStore((state) => state.historyBottomSplit)
  const setHistoryRightSplit = useWorkspaceStore((state) => state.setHistoryRightSplit)
  const setHistoryBottomSplit = useWorkspaceStore((state) => state.setHistoryBottomSplit)

  const splitPct = inspectorPosition === 'bottom' ? historyBottomSplit : historyRightSplit
  const setSplitPct = inspectorPosition === 'bottom' ? setHistoryBottomSplit : setHistoryRightSplit

  function handleTabChange(tab: HistoryTab) {
    setHistoryTab(tab)
    setSelectedRequestId(null)
  }

  const inspector = historyTab === 'websocket'
    ? <WSConnectionInspector />
    : <RequestInspector edge={inspectorPosition === 'bottom' ? 'top' : 'left'} />

  return (
    <RequestWorkspaceLayout
      position={inspectorPosition}
      splitPct={splitPct}
      onSplitChange={setSplitPct}
      inspectorVisible={Boolean(selectedId)}
      primary={<RequestTable historyTab={historyTab} onTabChange={handleTabChange} />}
      inspector={inspector}
    />
  )
}
