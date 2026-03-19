import { useEffect, useMemo, useState } from 'react'
import { useProxyStore } from '@/store/proxy'
import { useRequests } from '@/hooks/useRequests'
import { MethodBadge } from '@/components/common/MethodBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Checkbox } from '@/components/ui/Checkbox'
import { cn } from '@/lib/utils'
import { api, type Request, type ScopeRule } from '@/api/client'
import { Globe, Filter, RotateCcw, Trash2, ChevronUp, ChevronDown, Target, GitBranch, Highlighter, Sparkles } from 'lucide-react'
import { FilterModal } from './FilterModal'
import { AddToFlowModal } from '@/components/flows/AddToFlowModal'
import { countActiveFilters, filterRequests, isWebSocket } from '@/lib/requestFilters'
import { parseRequestTags, REQUEST_TAG_HIGHLIGHTED } from '@/lib/requestTags'
import { subscribeShortcutAction } from '@/lib/shortcuts'
import { Select } from '@/components/ui/Select'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildExcludeRule(
  kind: 'entirely' | 'host' | 'path' | 'subpath',
  req: Request,
): ScopeRule {
  switch (kind) {
    case 'entirely':
      return { enabled: true, pattern_type: 'exact', host: req.host, path: req.path }
    case 'host':
      return { enabled: true, pattern_type: 'exact', host: req.host, path: '' }
    case 'path':
      return { enabled: true, pattern_type: 'regex', host: '.*', path: `^${escapeRegex(req.path)}$` }
    case 'subpath':
      return {
        enabled: true,
        pattern_type: 'regex',
        host: `^${escapeRegex(req.host)}$`,
        path: `^${escapeRegex(req.path)}`,
      }
  }
}

type SortColumn = 'id' | 'method' | 'status' | 'host' | 'path' | 'query' | 'size' | 'time'
type SortDirection = 'asc' | 'desc' | null
export type HistoryTab = 'http' | 'websocket'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function truncateQuery(query: string, maxLength: number): string {
  if (!query || query.length <= maxLength) return query
  const half = Math.floor((maxLength - 3) / 2)
  return `${query.slice(0, half)}...${query.slice(-half)}`
}

function truncatePath(path: string, maxLength: number): string {
  if (!path || path.length <= maxLength) return path
  return `${path.slice(0, maxLength)}...`
}

function isHighlighted(req: Request): boolean {
  return parseRequestTags(req).includes(REQUEST_TAG_HIGHLIGHTED)
}

function nextRequestTags(req: Request, highlighted: boolean): string[] {
  const tags = parseRequestTags(req)
  if (highlighted) {
    return tags.includes(REQUEST_TAG_HIGHLIGHTED) ? tags : [...tags, REQUEST_TAG_HIGHLIGHTED]
  }
  return tags.filter((tag) => tag !== REQUEST_TAG_HIGHLIGHTED)
}

export function RequestTable({
  historyTab,
  onTabChange,
}: {
  historyTab: HistoryTab
  onTabChange: (tab: HistoryTab) => void
}) {
  useRequests()

  const {
    requests,
    selectedRequestId,
    setSelectedRequestId,
    filters,
    setFilters,
    addToReplay,
    removeRequestFromReplay,
    replayQueue,
    updateRequest,
    removeRequests,
    clearRequests,
  } = useProxyStore()
  const scope = useProxyStore((s) => s.project?.scope)

  const [sortColumn, setSortColumn] = useState<SortColumn>('id')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<'highlight' | 'delete' | 'clear' | null>(null)

  useEffect(() => {
    return subscribeShortcutAction((actionId) => {
      if (actionId === 'common.openFilters') {
        setFilterModalOpen(true)
      } else if (actionId === 'common.closeCurrent' || actionId === 'common.escape') {
        setFilterModalOpen(false)
      }
    })
  }, [])

  useEffect(() => {
    setSelectedIds([])
  }, [historyTab])

  useEffect(() => {
    const existing = new Set(requests.map((req) => req.id))
    setSelectedIds((current) => current.filter((id) => existing.has(id)))
  }, [requests])

  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => {
      if (!sortDirection) return 0

      let comparison = 0

      switch (sortColumn) {
        case 'id':
          comparison = a.id - b.id
          break
        case 'method':
          comparison = a.method.localeCompare(b.method)
          break
        case 'status': {
          const aStatus = a.response?.status_code || 0
          const bStatus = b.response?.status_code || 0
          comparison = aStatus - bStatus
          break
        }
        case 'host':
          comparison = a.host.localeCompare(b.host)
          break
        case 'path':
          comparison = a.path.localeCompare(b.path)
          break
        case 'query':
          comparison = (a.query || '').localeCompare(b.query || '')
          break
        case 'size': {
          const aSize = a.response?.size_bytes || 0
          const bSize = b.response?.size_bytes || 0
          comparison = aSize - bSize
          break
        }
        case 'time': {
          const aTime = a.response?.duration_ms || 0
          const bTime = b.response?.duration_ms || 0
          comparison = aTime - bTime
          break
        }
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [requests, sortColumn, sortDirection])

  const httpCount = useMemo(() => requests.filter((r) => !isWebSocket(r)).length, [requests])
  const wsCount = useMemo(() => requests.filter((r) => isWebSocket(r)).length, [requests])

  const partitionedRequests = useMemo(
    () => sortedRequests.filter((r) => historyTab === 'websocket' ? isWebSocket(r) : !isWebSocket(r)),
    [sortedRequests, historyTab],
  )

  const filteredRequests = useMemo(
    () => filterRequests(partitionedRequests, filters, scope),
    [partitionedRequests, filters, scope],
  )

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedRequests = useMemo(
    () => filteredRequests.filter((req) => selectedIdSet.has(req.id)),
    [filteredRequests, selectedIdSet],
  )
  const selectedCount = selectedRequests.length
  const highlightedSelectedCount = selectedRequests.filter(isHighlighted).length
  const allSelectedHighlighted = selectedCount > 0 && highlightedSelectedCount === selectedCount
  const allVisibleSelected = filteredRequests.length > 0 && filteredRequests.every((req) => selectedIdSet.has(req.id))
  const someVisibleSelected = filteredRequests.some((req) => selectedIdSet.has(req.id))
  const activeFilterCount = countActiveFilters(filters)

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('desc')
    }
  }

  function getSortIcon(column: SortColumn) {
    if (sortColumn !== column) return null
    return sortDirection === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  function toggleSelected(id: number, checked: boolean) {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(id) ? current : [...current, id]
      }
      return current.filter((currentId) => currentId !== id)
    })
  }

  function toggleSelectAll(checked: boolean) {
    if (!checked) {
      setSelectedIds((current) => current.filter((id) => !filteredRequests.some((req) => req.id === id)))
      return
    }
    const visibleIds = filteredRequests.map((req) => req.id)
    setSelectedIds((current) => Array.from(new Set([...current, ...visibleIds])))
  }

  async function applyHighlightToSelection(highlighted: boolean) {
    if (selectedRequests.length === 0) return
    setBusyAction('highlight')
    try {
      const updatedRequests = await Promise.all(
        selectedRequests.map((req) => api.requests.updateTags(req.id, nextRequestTags(req, highlighted))),
      )
      updatedRequests.forEach((req) => updateRequest(req))
    } catch (err) {
      console.error(err)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleDeleteSelected() {
    if (selectedRequests.length === 0) return
    setBusyAction('delete')
    const ids = selectedRequests.map((req) => req.id)
    try {
      await api.requests.deleteBulk(ids)
      removeRequests(ids)
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
      setDeleteConfirmOpen(false)
    } catch (err) {
      console.error(err)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleClearHistory() {
    setBusyAction('clear')
    try {
      await api.requests.clear()
      clearRequests()
      setSelectedIds([])
      setClearConfirmOpen(false)
    } catch (err) {
      console.error(err)
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-border bg-card">
        {([
          { id: 'http' as HistoryTab, label: 'HTTP', count: httpCount },
          { id: 'websocket' as HistoryTab, label: 'WebSocket', count: wsCount },
        ]).map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors -mb-px',
              historyTab === id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
              historyTab === id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
            )}>
              {count}
            </span>
          </button>
        ))}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <button
          onClick={() => setFilterModalOpen(true)}
          className={cn(
            'flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 transition-colors',
            activeFilterCount > 0
              ? 'border-primary bg-primary/20 text-primary'
              : 'text-muted-foreground hover:bg-muted',
          )}
          title="Advanced Filters"
        >
          <Filter size={16} />
          <span className="text-sm">Filter</span>
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </button>

        {historyTab === 'http' && (
          <Select
            value={filters.method}
            onChange={(v) => setFilters({ method: v })}
            options={[
              { value: '', label: 'All Methods' },
              ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map((m) => ({ value: m, label: m })),
            ]}
            className="py-1.5 text-sm"
          />
        )}

        <span className="px-2 text-xs text-muted-foreground">
          {filteredRequests.length} {historyTab === 'websocket' ? 'connections' : 'requests'}
        </span>

        {selectedCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
              <Sparkles size={13} className="text-amber-300" />
              {selectedCount} selected
            </span>
            <button
              type="button"
              onClick={() => applyHighlightToSelection(!allSelectedHighlighted)}
              disabled={busyAction !== null}
              className="flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Highlighter size={13} />
              {allSelectedHighlighted ? 'Remove Highlight' : 'Highlight'}
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={busyAction !== null}
              className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size={13} />
              Delete Selected
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setClearConfirmOpen(true)}
            disabled={requests.length === 0 || busyAction !== null}
            className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={15} />
            Clear History
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-card text-xs font-medium text-muted-foreground">
              <th className="w-10 px-3 py-2 text-left">
                <Checkbox
                  checked={allVisibleSelected}
                  indeterminate={!allVisibleSelected && someVisibleSelected}
                  onChange={toggleSelectAll}
                  title={allVisibleSelected ? 'Clear visible selection' : 'Select visible rows'}
                />
              </th>
              <th
                onClick={() => handleSort('id')}
                className="w-14 cursor-pointer select-none px-3 py-2 text-left hover:text-foreground"
              >
                <div className="flex items-center gap-1">
                  #{getSortIcon('id')}
                </div>
              </th>
              <th
                onClick={() => handleSort('method')}
                className="w-20 cursor-pointer select-none px-3 py-2 text-left hover:text-foreground"
              >
                <div className="flex items-center gap-1">
                  Method{getSortIcon('method')}
                </div>
              </th>
              <th
                onClick={() => handleSort('status')}
                className="w-12 cursor-pointer select-none px-3 py-2 text-left hover:text-foreground"
              >
                <div className="flex items-center gap-1">
                  Status{getSortIcon('status')}
                </div>
              </th>
              <th
                onClick={() => handleSort('host')}
                className="min-w-0 w-[160px] cursor-pointer select-none px-3 py-2 text-left hover:text-foreground"
              >
                <div className="flex items-center gap-1">
                  Host{getSortIcon('host')}
                </div>
              </th>
              <th
                onClick={() => handleSort('path')}
                className="min-w-0 w-[140px] cursor-pointer select-none px-3 py-2 text-left hover:text-foreground"
              >
                <div className="flex items-center gap-1">
                  Path{getSortIcon('path')}
                </div>
              </th>
              <th
                onClick={() => handleSort('query')}
                className="min-w-0 w-[140px] cursor-pointer select-none px-3 py-2 text-left hover:text-foreground"
              >
                <div className="flex items-center gap-1">
                  Query{getSortIcon('query')}
                </div>
              </th>
              <th
                onClick={() => handleSort('size')}
                className="hidden w-20 cursor-pointer select-none px-3 py-2 text-right hover:text-foreground min-[900px]:table-cell"
              >
                <div className="flex items-center justify-end gap-1">
                  Size{getSortIcon('size')}
                </div>
              </th>
              <th
                onClick={() => handleSort('time')}
                className="hidden w-20 cursor-pointer select-none px-3 py-2 text-right hover:text-foreground min-[900px]:table-cell"
              >
                <div className="flex items-center justify-end gap-1">
                  Time{getSortIcon('time')}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRequests.map((req) => (
              <RequestRow
                key={req.id}
                req={req}
                selected={req.id === selectedRequestId}
                checked={selectedIdSet.has(req.id)}
                highlighted={isHighlighted(req)}
                inReplay={replayQueue.some((entry) => entry.request.id === req.id)}
                onToggleChecked={(checked) => toggleSelected(req.id, checked)}
                onClick={() => setSelectedRequestId(req.id === selectedRequestId ? null : req.id)}
                onAddToReplay={() => addToReplay(req)}
                onRemoveFromReplay={() => removeRequestFromReplay(req.id)}
                onToggleHighlight={async () => {
                  try {
                    const updated = await api.requests.updateTags(req.id, nextRequestTags(req, !isHighlighted(req)))
                    updateRequest(updated)
                  } catch (err) {
                    console.error(err)
                  }
                }}
              />
            ))}
          </tbody>
        </table>

        {filteredRequests.length === 0 && (
          <div className="flex h-40 flex-col items-center justify-center text-muted-foreground">
            <Globe className="mb-2 opacity-30" size={32} />
            {historyTab === 'websocket' ? (
              <>
                <p className="text-sm">No WebSocket connections</p>
                <p className="mt-1 text-xs">WebSocket upgrades will appear here</p>
              </>
            ) : (
              <>
                <p className="text-sm">No requests found</p>
                <p className="mt-1 text-xs">Try adjusting your filters or configure proxy on port 8080</p>
              </>
            )}
          </div>
        )}
      </div>

      <FilterModal isOpen={filterModalOpen} onClose={() => setFilterModalOpen(false)} />

      <ConfirmDialog
        open={deleteConfirmOpen}
        title={`Delete ${selectedCount} selected ${selectedCount === 1 ? 'entry' : 'entries'}?`}
        description="This will permanently remove the selected history items, including any captured response bodies and WebSocket frames linked to them."
        confirmLabel="Delete Selected"
        busy={busyAction === 'delete'}
        onConfirm={handleDeleteSelected}
        onClose={() => setDeleteConfirmOpen(false)}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        title="Clear all history?"
        description="This will permanently remove all captured HTTP requests, WebSocket connections, and stored frames from the current project."
        confirmLabel="Clear History"
        busy={busyAction === 'clear'}
        onConfirm={handleClearHistory}
        onClose={() => setClearConfirmOpen(false)}
      />
    </div>
  )
}

export { AddToFlowModal }

function RequestRow({
  req,
  selected,
  checked,
  highlighted,
  inReplay,
  onToggleChecked,
  onClick,
  onAddToReplay,
  onRemoveFromReplay,
  onToggleHighlight,
}: {
  req: Request
  selected: boolean
  checked: boolean
  highlighted: boolean
  inReplay: boolean
  onToggleChecked: (checked: boolean) => void
  onClick: () => void
  onAddToReplay: () => void
  onRemoveFromReplay: () => void
  onToggleHighlight: () => void
}) {
  const project = useProxyStore((s) => s.project)
  const setProject = useProxyStore((s) => s.setProject)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [addToFlowOpen, setAddToFlowOpen] = useState(false)

  async function addExcludeRule(kind: 'entirely' | 'host' | 'path' | 'subpath') {
    const scope = project?.scope ?? { enabled: false, include_rules: [], exclude_rules: [] }
    const rule = buildExcludeRule(kind, req)
    const updated = await api.project.update({
      scope: { ...scope, exclude_rules: [...scope.exclude_rules, rule] },
    })
    setProject(updated)
  }

  useEffect(() => {
    if (!contextMenuOpen) return

    function handleOutsideClick() {
      setContextMenuOpen(false)
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setContextMenuOpen(false)
    }

    document.addEventListener('click', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('click', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenuOpen])

  const resp = req.response
  const displayPath = truncatePath(req.path, 60)
  const displayQuery = req.query ? truncateQuery(req.query, 30) : ''

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setContextMenuOpen(true)
  }

  function closeContextMenu() {
    setContextMenuOpen(false)
  }

  return (
    <>
      <tr
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className={cn(
          'cursor-pointer border-b border-border/50 transition-colors',
          selected
            ? 'bg-primary/10 border-primary/30'
            : highlighted
              ? 'bg-amber-500/[0.08] hover:bg-amber-500/[0.12]'
              : 'hover:bg-muted/30',
        )}
      >
        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={checked}
            onChange={onToggleChecked}
            className={highlighted ? 'border-amber-400/50 data-[state=checked]:border-primary' : undefined}
            title={checked ? 'Deselect request' : 'Select request'}
          />
        </td>
        <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {highlighted && <span className="h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.55)]" />}
            <span>{req.id}</span>
          </div>
        </td>
        <td className="px-3 py-1.5">
          <MethodBadge method={req.method} />
        </td>
        <td className="px-3 py-1.5">
          {isWebSocket(req) ? (
            <span className="rounded border border-teal-500/30 bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-bold text-teal-400">WS</span>
          ) : resp ? (
            <StatusBadge code={resp.status_code} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="min-w-0 w-[160px] max-w-[160px] px-3 py-1.5 font-mono text-xs text-muted-foreground">
          <div className="truncate">{req.host}</div>
        </td>
        <td className="min-w-0 w-[140px] px-3 py-1.5 font-mono text-xs">
          <div className="truncate text-foreground">{displayPath}</div>
        </td>
        <td className="min-w-0 w-[140px] px-3 py-1.5 font-mono text-xs text-muted-foreground">
          <div className="truncate">
            {displayQuery ? <span className="opacity-60">{displayQuery}</span> : <span className="text-muted-foreground">—</span>}
          </div>
        </td>
        <td className="hidden px-3 py-1.5 text-right font-mono text-xs text-muted-foreground min-[900px]:table-cell">
          {resp ? formatBytes(resp.size_bytes) : '—'}
        </td>
        <td className="hidden px-3 py-1.5 text-right font-mono text-xs text-muted-foreground min-[900px]:table-cell">
          {resp ? `${resp.duration_ms}ms` : '—'}
        </td>
      </tr>

      <AddToFlowModal
        open={addToFlowOpen}
        request={req}
        onClose={() => setAddToFlowOpen(false)}
      />

      {contextMenuOpen && (
        <div
          className="fixed z-50 min-w-[240px] rounded-lg border border-border bg-card py-1 shadow-lg"
          style={{
            left: `${contextMenuPosition.x}px`,
            top: `${contextMenuPosition.y}px`,
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onToggleHighlight(); closeContextMenu() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            <Highlighter size={14} className={highlighted ? 'text-amber-300' : undefined} />
            {highlighted ? 'Remove highlight' : 'Highlight in history'}
          </button>

          {inReplay ? (
            <button
              onClick={(e) => { e.stopPropagation(); onRemoveFromReplay(); closeContextMenu() }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
            >
              <Trash2 size={14} />
              Remove from Replay
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onAddToReplay(); closeContextMenu() }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
            >
              <RotateCcw size={14} />
              Send to Replay
            </button>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); setAddToFlowOpen(true); closeContextMenu() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            <GitBranch size={14} />
            Send to Flow
          </button>

          <div className="my-1 border-t border-border" />

          <div className="px-3 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Remove from Scope
            </span>
          </div>

          {([
            { kind: 'entirely', label: 'Remove entirely', desc: 'exact host + exact path' },
            { kind: 'host', label: 'Remove host', desc: 'exact host, any path' },
            { kind: 'path', label: 'Remove path', desc: 'exact path, any host' },
            { kind: 'subpath', label: 'Remove sub-path', desc: 'exact host, path + all sub-paths' },
          ] as const).map(({ kind, label, desc }) => (
            <button
              key={kind}
              onClick={(e) => {
                e.stopPropagation()
                addExcludeRule(kind).catch(console.error)
                closeContextMenu()
              }}
              className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted"
            >
              <Target size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <div className="text-sm">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
