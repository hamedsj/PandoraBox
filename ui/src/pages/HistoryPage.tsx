import { useState } from 'react'
import { RequestTable, type HistoryTab } from '@/components/history/RequestTable'
import { RequestInspector } from '@/components/inspector/RequestInspector'
import { WSConnectionInspector } from '@/components/inspector/WSConnectionInspector'
import { TeamMemberTab } from '@/components/team/TeamMemberTab'
import { useProxyStore } from '@/store/proxy'
import { useWorkspaceStore } from '@/store/workspace'
import { useTeamStore } from '@/store/team'
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

  // Team state
  const members = useTeamStore((s) => s.members)
  const activeUserTab = useTeamStore((s) => s.activeUserTab)
  const setActiveUserTab = useTeamStore((s) => s.setActiveUserTab)
  const isTeamActive = members.length > 0

  const splitPct = inspectorPosition === 'bottom' ? historyBottomSplit : historyRightSplit
  const setSplitPct = inspectorPosition === 'bottom' ? setHistoryBottomSplit : setHistoryRightSplit

  function handleTabChange(tab: HistoryTab) {
    setHistoryTab(tab)
    setSelectedRequestId(null)
  }

  const inspector = historyTab === 'websocket'
    ? <WSConnectionInspector />
    : <RequestInspector edge={inspectorPosition === 'bottom' ? 'top' : 'left'} />

  // Build the team user-filter tabs bar (shown above the table when in team mode).
  const teamTabsBar = isTeamActive ? (
    <div className="flex items-center gap-1 px-3 pt-2 pb-0 border-b border-border/50 overflow-x-auto">
      <button
        type="button"
        onClick={() => setActiveUserTab('all')}
        className={[
          'px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
          activeUserTab === 'all'
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
        ].join(' ')}
      >
        All Traffic
      </button>
      <button
        type="button"
        onClick={() => setActiveUserTab('mine')}
        className={[
          'px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
          activeUserTab === 'mine'
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
        ].join(' ')}
      >
        My Traffic
      </button>
      {members.map((member) => (
        <TeamMemberTab
          key={member.user_id}
          member={member}
          active={activeUserTab === member.user_id}
          onClick={() => setActiveUserTab(member.user_id)}
        />
      ))}
    </div>
  ) : null

  const table = (
    <div className="flex flex-col h-full">
      {teamTabsBar}
      <div className="flex-1 min-h-0">
        <RequestTable
          historyTab={historyTab}
          onTabChange={handleTabChange}
          userFilter={isTeamActive ? activeUserTab : undefined}
        />
      </div>
    </div>
  )

  return (
    <RequestWorkspaceLayout
      position={inspectorPosition}
      splitPct={splitPct}
      onSplitChange={setSplitPct}
      inspectorVisible={Boolean(selectedId)}
      primary={table}
      inspector={inspector}
    />
  )
}
