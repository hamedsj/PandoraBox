import { RequestTable } from '@/components/history/RequestTable'
import { RequestInspector } from '@/components/inspector/RequestInspector'
import { useProxyStore } from '@/store/proxy'
import { useWorkspaceStore } from '@/store/workspace'
import { RequestWorkspaceLayout } from '@/components/layout/RequestWorkspaceLayout'

export function HistoryPage() {
  const selectedId = useProxyStore((s) => s.selectedRequestId)
  const inspectorPosition = useWorkspaceStore((state) => state.inspectorPosition)
  const historyRightSplit = useWorkspaceStore((state) => state.historyRightSplit)
  const historyBottomSplit = useWorkspaceStore((state) => state.historyBottomSplit)
  const setHistoryRightSplit = useWorkspaceStore((state) => state.setHistoryRightSplit)
  const setHistoryBottomSplit = useWorkspaceStore((state) => state.setHistoryBottomSplit)

  const splitPct = inspectorPosition === 'bottom' ? historyBottomSplit : historyRightSplit
  const setSplitPct = inspectorPosition === 'bottom' ? setHistoryBottomSplit : setHistoryRightSplit

  return (
    <RequestWorkspaceLayout
      position={inspectorPosition}
      splitPct={splitPct}
      onSplitChange={setSplitPct}
      inspectorVisible={Boolean(selectedId)}
      primary={<RequestTable />}
      inspector={<RequestInspector edge={inspectorPosition === 'bottom' ? 'top' : 'left'} />}
    />
  )
}
