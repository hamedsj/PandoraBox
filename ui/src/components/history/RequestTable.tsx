import { useState, useCallback, useEffect, useMemo } from 'react'
import { useProxyStore } from '@/store/proxy'
import { useRequests } from '@/hooks/useRequests'
import { MethodBadge } from '@/components/common/MethodBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { cn } from '@/lib/utils'
import { api, type Request, type ScopeRule } from '@/api/client'
import { Globe, Filter, RotateCcw, Trash2, ChevronUp, ChevronDown, Target } from 'lucide-react'
import { FilterModal } from './FilterModal'
import { countActiveFilters, filterRequests, isWebSocket } from '@/lib/requestFilters'
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
      // any host, exact path → regex: host .* / path anchored
      return { enabled: true, pattern_type: 'regex', host: '.*', path: `^${escapeRegex(req.path)}$` }
    case 'subpath':
      // exact host, path starts-with current path → regex anchored prefix
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

export function RequestTable({
  historyTab,
  onTabChange,
}: {
  historyTab: HistoryTab
  onTabChange: (tab: HistoryTab) => void
}) {
  useRequests()

  const { requests, selectedRequestId, setSelectedRequestId, filters, setFilters, addToReplay, removeRequestFromReplay, replayQueue } = useProxyStore()
  const scope = useProxyStore((s) => s.project?.scope)

  const [sortColumn, setSortColumn] = useState<SortColumn>('id')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [filterModalOpen, setFilterModalOpen] = useState(false)

  useEffect(() => {
    return subscribeShortcutAction((actionId) => {
      if (actionId === 'common.openFilters') {
        setFilterModalOpen(true)
      } else if (actionId === 'common.closeCurrent' || actionId === 'common.escape') {
        setFilterModalOpen(false)
      }
    })
  }, [])

  // Sort requests
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

  // Tab counts (unfiltered, just partitioned by type)
  const httpCount = useMemo(() => requests.filter((r) => !isWebSocket(r)).length, [requests])
  const wsCount = useMemo(() => requests.filter((r) => isWebSocket(r)).length, [requests])

  // Partition by active tab, then apply user filters
  const partitionedRequests = useMemo(
    () => sortedRequests.filter((r) => historyTab === 'websocket' ? isWebSocket(r) : !isWebSocket(r)),
    [sortedRequests, historyTab]
  )

  const filteredRequests = useMemo(
    () => filterRequests(partitionedRequests, filters, scope),
    [partitionedRequests, filters, scope]
  )

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('desc')
    }
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

  function getSortIcon(column: SortColumn) {
    if (sortColumn !== column) return null
    return sortDirection === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  const activeFilterCount = countActiveFilters(filters)

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-border bg-card shrink-0">
        {([
          { id: 'http' as HistoryTab, label: 'HTTP', count: httpCount },
          { id: 'websocket' as HistoryTab, label: 'WebSocket', count: wsCount },
        ]).map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors',
              historyTab === id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
            <span className={cn(
              'px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
              historyTab === id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
            )}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
        <button
          onClick={() => setFilterModalOpen(true)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors border border-border',
            activeFilterCount > 0 ? 'bg-primary/20 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'
          )}
          title="Advanced Filters"
        >
          <Filter size={16} />
          <span className="text-sm">Filter</span>
          {activeFilterCount > 0 && (
            <span className="bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full font-medium">
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
            className="text-sm py-1.5"
          />
        )}
        <span className="text-xs text-muted-foreground px-2">
          {filteredRequests.length} {historyTab === 'websocket' ? 'connections' : 'requests'}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-card border-b border-border text-muted-foreground text-xs font-medium">
              <th
                onClick={() => handleSort('id')}
                className="text-left px-3 py-2 w-8 cursor-pointer hover:text-foreground select-none"
              >
                <div className="flex items-center gap-1">
                  #{getSortIcon('id')}
                </div>
              </th>
              <th
                onClick={() => handleSort('method')}
                className="text-left px-3 py-2 w-20 cursor-pointer hover:text-foreground select-none"
              >
                <div className="flex items-center gap-1">
                  Method{getSortIcon('method')}
                </div>
              </th>
              <th
                onClick={() => handleSort('status')}
                className="text-left px-3 py-2 w-12 cursor-pointer hover:text-foreground select-none"
              >
                <div className="flex items-center gap-1">
                  Status{getSortIcon('status')}
                </div>
              </th>
              <th
                onClick={() => handleSort('host')}
                className="text-left px-3 py-2 min-w-0 w-[160px] cursor-pointer hover:text-foreground select-none"
              >
                <div className="flex items-center gap-1">
                  Host{getSortIcon('host')}
                </div>
              </th>
              <th
                onClick={() => handleSort('path')}
                className="text-left px-3 py-2 min-w-0 w-[140px] cursor-pointer hover:text-foreground select-none"
              >
                <div className="flex items-center gap-1">
                  Path{getSortIcon('path')}
                </div>
              </th>
              <th
                onClick={() => handleSort('query')}
                className="text-left px-3 py-2 min-w-0 w-[140px] cursor-pointer hover:text-foreground select-none"
              >
                <div className="flex items-center gap-1">
                  Query{getSortIcon('query')}
                </div>
              </th>
              <th
                onClick={() => handleSort('size')}
                className="text-right px-3 py-2 w-20 hidden min-[900px]:table-cell cursor-pointer hover:text-foreground select-none"
              >
                <div className="flex items-center justify-end gap-1">
                  Size{getSortIcon('size')}
                </div>
              </th>
              <th
                onClick={() => handleSort('time')}
                className="text-right px-3 py-2 w-20 hidden min-[900px]:table-cell cursor-pointer hover:text-foreground select-none"
              >
                <div className="flex items-center justify-end gap-1">
                  Time{getSortIcon('time')}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRequests.map((req: Request) => (
              <RequestRow
                key={req.id}
                req={req}
                selected={req.id === selectedRequestId}
                inReplay={replayQueue.some((entry) => entry.request.id === req.id)}
                onClick={() => setSelectedRequestId(req.id === selectedRequestId ? null : req.id)}
                onAddToReplay={() => addToReplay(req)}
                onRemoveFromReplay={() => removeRequestFromReplay(req.id)}
                truncateQuery={truncateQuery}
                truncatePath={truncatePath}
              />
            ))}
          </tbody>
        </table>
        {filteredRequests.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <Globe className="mb-2 opacity-30" size={32} />
            {historyTab === 'websocket' ? (
              <>
                <p className="text-sm">No WebSocket connections</p>
                <p className="text-xs mt-1">WebSocket upgrades will appear here</p>
              </>
            ) : (
              <>
                <p className="text-sm">No requests found</p>
                <p className="text-xs mt-1">Try adjusting your filters or configure proxy on port 8080</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Filter Modal */}
      <FilterModal isOpen={filterModalOpen} onClose={() => setFilterModalOpen(false)} />
    </div>
  )
}

function RequestRow({
  req,
  selected,
  inReplay,
  onClick,
  onAddToReplay,
  onRemoveFromReplay,
  truncateQuery,
  truncatePath,
}: {
  req: Request
  selected: boolean
  inReplay: boolean
  onClick: () => void
  onAddToReplay: () => void
  onRemoveFromReplay: () => void
  truncateQuery: (query: string, max: number) => string
  truncatePath: (path: string, max: number) => string
}) {
  const project = useProxyStore((s) => s.project)
  const setProject = useProxyStore((s) => s.setProject)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })

  async function addExcludeRule(kind: 'entirely' | 'host' | 'path' | 'subpath') {
    const scope = project?.scope ?? { enabled: false, include_rules: [], exclude_rules: [] }
    const rule = buildExcludeRule(kind, req)
    const updated = await api.project.update({
      scope: { ...scope, exclude_rules: [...scope.exclude_rules, rule] },
    })
    setProject(updated)
  }

  const resp = req.response

  // Truncate path with "..." at the end (max 60 chars)
  const displayPath = truncatePath(req.path, 60)

  // Truncate query string with "..." in the middle (max 30 chars)
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

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleOutsideClick = () => setContextMenuOpen(false)
      document.addEventListener('click', handleOutsideClick)
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setContextMenuOpen(false)
      })
      return () => {
        document.removeEventListener('click', handleOutsideClick)
      }
    }
  })

  return (
    <>
      <tr
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className={cn(
          'border-b border-border/50 cursor-pointer transition-colors',
          selected
            ? 'bg-primary/10 border-primary/30'
            : 'hover:bg-muted/30'
        )}
      >
        <td className="px-3 py-1.5 text-muted-foreground font-mono text-xs">{req.id}</td>
        <td className="px-3 py-1.5">
          <MethodBadge method={req.method} />
        </td>
        <td className="px-3 py-1.5">
          {isWebSocket(req) ? (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-400 border border-teal-500/30">WS</span>
          ) : resp ? (
            <StatusBadge code={resp.status_code} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground min-w-0 w-[160px] max-w-[160px]">
          <div className="truncate">{req.host}</div>
        </td>
        <td className="px-3 py-1.5 font-mono text-xs min-w-0 w-[140px]">
          <div className="truncate text-foreground">{displayPath}</div>
        </td>
        <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground min-w-0 w-[140px]">
          <div className="truncate">
            {displayQuery ? (
              <span className="opacity-60">{displayQuery}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </td>
        <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground hidden min-[900px]:table-cell">
          {resp ? formatBytes(resp.size_bytes) : '—'}
        </td>
        <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground hidden min-[900px]:table-cell">
          {resp ? `${resp.duration_ms}ms` : '—'}
        </td>
      </tr>

      {/* Context Menu */}
      {contextMenuOpen && (
        <div
          className="fixed bg-card border border-border rounded-lg shadow-lg py-1 z-50 min-w-[220px]"
          style={{
            left: `${contextMenuPosition.x}px`,
            top: `${contextMenuPosition.y}px`,
          }}
        >
          {inReplay ? (
            <button
              onClick={(e) => { e.stopPropagation(); onRemoveFromReplay(); closeContextMenu() }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
            >
              <Trash2 size={14} />
              Remove from Replay
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onAddToReplay(); closeContextMenu() }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
            >
              <RotateCcw size={14} />
              Send to Replay
            </button>
          )}

          <div className="my-1 border-t border-border" />

          <div className="px-3 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Remove from Scope
            </span>
          </div>

          {(
            [
              { kind: 'entirely', label: 'Remove entirely', desc: 'exact host + exact path' },
              { kind: 'host',     label: 'Remove host',     desc: 'exact host, any path' },
              { kind: 'path',     label: 'Remove path',     desc: 'exact path, any host' },
              { kind: 'subpath',  label: 'Remove sub-path', desc: 'exact host, path + all sub-paths' },
            ] as const
          ).map(({ kind, label, desc }) => (
            <button
              key={kind}
              onClick={(e) => {
                e.stopPropagation()
                addExcludeRule(kind).catch(console.error)
                closeContextMenu()
              }}
              className="w-full flex items-start gap-2 px-3 py-2 hover:bg-muted transition-colors text-left"
            >
              <Target size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-sm">{label}</div>
                <div className="text-[11px] text-muted-foreground">{desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}
