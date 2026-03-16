import { useState, useCallback, useEffect, useMemo } from 'react'
import { useProxyStore } from '@/store/proxy'
import { useRequests } from '@/hooks/useRequests'
import { MethodBadge } from '@/components/common/MethodBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { cn } from '@/lib/utils'
import type { Request } from '@/api/client'
import { Search, Globe, Filter, RotateCcw, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { FilterModal } from './FilterModal'

type SortColumn = 'id' | 'method' | 'status' | 'host' | 'path' | 'query' | 'size' | 'time'
type SortDirection = 'asc' | 'desc' | null

export function RequestTable() {
  useRequests()

  const { requests, selectedRequestId, setSelectedRequestId, filters, setFilters, addToReplay, removeFromReplay, replayQueue } = useProxyStore()

  const [sortColumn, setSortColumn] = useState<SortColumn>('id')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [filterModalOpen, setFilterModalOpen] = useState(false)

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

  // Filter requests
  const filteredRequests = useMemo(() => {
    return sortedRequests.filter((req: Request) => {
      // Method filter
      if (filters.method && req.method !== filters.method) return false

      // Host filter
      if (filters.host && !req.host.toLowerCase().includes(filters.host.toLowerCase())) return false

      // File extension filters
      if (filters.extensionShow || filters.extensionHide) {
        const pathLower = req.path.toLowerCase().split('?')[0]
        if (filters.extensionShow) {
          const ext = '.' + filters.extensionShow.toLowerCase().replace(/^\./, '')
          if (!pathLower.endsWith(ext)) return false
        }
        if (filters.extensionHide) {
          const ext = '.' + filters.extensionHide.toLowerCase().replace(/^\./, '')
          if (pathLower.endsWith(ext)) return false
        }
      }

      // Status code filter
      if (filters.statusCodes.length > 0) {
        const status = req.response?.status_code
        if (!status) return false
        const matches = filters.statusCodes.some(code => Math.floor(status / 100) === parseInt(code[0]))
        if (!matches) return false
      }

      // Content-Type filters (response headers)
      if (filters.contentTypeShow || filters.contentTypeHide) {
        let ct = ''
        try {
          const h = req.response ? JSON.parse(req.response.headers ?? '{}') : {}
          ct = (h['content-type'] || h['Content-Type'] || '').toLowerCase()
        } catch { /* no response yet */ }

        if (filters.contentTypeShow && !ct.includes(filters.contentTypeShow.toLowerCase())) return false
        if (filters.contentTypeHide && ct.includes(filters.contentTypeHide.toLowerCase())) return false
      }

      // Search filter
      if (filters.search) {
        const inScope = (field: string) =>
          filters.searchScope.length === 0 || filters.searchScope.includes(field)

        const checkSearch = (value: string): boolean => {
          if (filters.useRegex) {
            try {
              return new RegExp(filters.search, filters.caseInsensitive ? 'i' : '').test(value)
            } catch {
              return false
            }
          }
          const haystack = filters.caseInsensitive ? value.toLowerCase() : value
          const needle = filters.caseInsensitive ? filters.search.toLowerCase() : filters.search
          return haystack.includes(needle)
        }

        const decodeBody = (body: number[] | null): string => {
          if (!body) return ''
          try { return new TextDecoder().decode(new Uint8Array(body)) } catch { return '' }
        }

        let matches = false
        if (!matches && inScope('host') && checkSearch(req.host)) matches = true
        if (!matches && inScope('path') && checkSearch(req.path)) matches = true
        if (!matches && inScope('query') && req.query && checkSearch(req.query)) matches = true
        if (!matches && inScope('req.headers') && checkSearch(req.headers)) matches = true
        if (!matches && inScope('req.body')) {
          const text = decodeBody(req.body)
          if (text) matches = checkSearch(text)
        }
        if (!matches && inScope('res.headers') && req.response?.headers) {
          matches = checkSearch(req.response.headers)
        }
        if (!matches && inScope('res.body')) {
          const text = decodeBody(req.response?.body ?? null)
          if (text) matches = checkSearch(text)
        }

        if (filters.negativeSearch ? matches : !matches) return false
      }

      return true
    })
  }, [sortedRequests, filters])

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

  const activeFilterCount = [
    filters.host,
    filters.extensionShow,
    filters.extensionHide,
    filters.contentTypeShow,
    filters.contentTypeHide,
    filters.statusCodes.length > 0,
    filters.negativeSearch,
    !filters.caseInsensitive,
    filters.useRegex,
    filters.searchScope.length > 0,
  ].filter(Boolean).length

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full pl-7 pr-3 py-1.5 text-sm bg-input border border-border rounded-md font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Search host, path, query..."
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
          />
        </div>
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
        <select
          className="text-sm bg-input border border-border rounded-md px-2 py-1.5 text-foreground focus:outline-none"
          value={filters.method}
          onChange={(e) => setFilters({ method: e.target.value })}
        >
          <option value="">All Methods</option>
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground px-2">
          {filteredRequests.length} requests
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
                inReplay={replayQueue.some((r: Request) => r.id === req.id)}
                onClick={() => setSelectedRequestId(req.id === selectedRequestId ? null : req.id)}
                onAddToReplay={() => addToReplay(req)}
                onRemoveFromReplay={() => removeFromReplay(req.id)}
                truncateQuery={truncateQuery}
                truncatePath={truncatePath}
              />
            ))}
          </tbody>
        </table>
        {filteredRequests.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <Globe className="mb-2 opacity-30" size={32} />
            <p className="text-sm">No requests found</p>
            <p className="text-xs mt-1">Try adjusting your filters or configure proxy on port 8080</p>
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
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })

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
          {resp ? <StatusBadge code={resp.status_code} /> : <span className="text-muted-foreground">—</span>}
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
          className="fixed bg-card border border-border rounded-lg shadow-lg py-1 z-50 min-w-[180px]"
          style={{
            left: `${contextMenuPosition.x}px`,
            top: `${contextMenuPosition.y}px`,
          }}
        >
          {inReplay ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemoveFromReplay()
                closeContextMenu()
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
            >
              <Trash2 size={14} />
              Remove from Replay
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAddToReplay()
                closeContextMenu()
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
            >
              <RotateCcw size={14} />
              Send to Replay
            </button>
          )}
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
