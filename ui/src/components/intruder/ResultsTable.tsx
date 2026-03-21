import { useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronUp, ChevronDown, Loader2, RotateCcw, GitBranch, FolderPlus, Link, Copy, Terminal, Code2, Crosshair, Filter } from 'lucide-react'
import { StatusBadge } from '@/components/common/StatusBadge'
import { ResultInspectorPanel } from './ResultInspectorPanel'
import { IntruderFilterModal, defaultIntruderFilters } from './IntruderFilterModal'
import type { IntruderFilters } from './IntruderFilterModal'
import { AddToFlowModal } from '@/components/flows/AddToFlowModal'
import { AddToOrganizerModal } from '@/components/organizer/AddToOrganizerModal'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useProxyStore } from '@/store/proxy'
import { useIntruderStore } from '@/store/intruder'
import { copyURL, copyRawRequest, copyAsCurl, copyAsFetch } from '@/lib/copyRequest'
import { api } from '@/api/client'
import type { Request } from '@/api/client'
import type { AttackResult } from '@/store/intruder'

type SortKey = 'index' | 'status' | 'length' | 'time'
type SortDir = 'asc' | 'desc'

interface Props {
  results: AttackResult[]
  markerCount: number
}

function countActiveFilters(f: IntruderFilters): number {
  return [
    f.search,
    !f.caseInsensitive,
    f.useRegex,
    f.negativeSearch,
    f.statusCodes.length > 0,
    f.minLen,
    f.maxLen,
    f.minTime,
    f.maxTime,
    f.errors !== 'all',
  ].filter(Boolean).length
}

function applyFilters(results: AttackResult[], f: IntruderFilters): AttackResult[] {
  return results.filter((r) => {
    // Errors filter
    const hasError = !!r.error
    if (f.errors === 'only' && !hasError) return false
    if (f.errors === 'hide' && hasError) return false

    // Status codes
    if (f.statusCodes.length > 0) {
      if (r.status == null) return false
      const code = String(r.status)
      const matches = f.statusCodes.some((chip) => {
        const prefix = chip[0]
        return code[0] === prefix
      })
      if (!matches) return false
    }

    // Length range
    if (f.minLen && (r.length == null || r.length < Number(f.minLen))) return false
    if (f.maxLen && (r.length == null || r.length > Number(f.maxLen))) return false

    // Time range
    if (f.minTime && r.time < Number(f.minTime)) return false
    if (f.maxTime && r.time > Number(f.maxTime)) return false

    // Payload search
    if (f.search) {
      const payloadText = r.payloads.join(' ')
      let match: boolean
      if (f.useRegex) {
        try {
          const re = new RegExp(f.search, f.caseInsensitive ? 'i' : '')
          match = re.test(payloadText)
        } catch {
          match = false
        }
      } else {
        const hay = f.caseInsensitive ? payloadText.toLowerCase() : payloadText
        const needle = f.caseInsensitive ? f.search.toLowerCase() : f.search
        match = hay.includes(needle)
      }
      if (f.negativeSearch ? match : !match) return false
    }

    return true
  })
}

export function ResultsTable({ results, markerCount }: Props) {
  const navigate = useNavigate()
  const parentRef = useRef<HTMLDivElement>(null)

  // Inspector
  const [inspected, setInspected] = useState<AttackResult | null>(null)

  // Sorting / filtering
  const [sortKey, setSortKey] = useState<SortKey>('index')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filters, setFilters] = useState<IntruderFilters>(defaultIntruderFilters)
  const [filterOpen, setFilterOpen] = useState(false)
  const activeFilterCount = countActiveFilters(filters)

  // Context menu
  const { open: menuOpen, openMenu, close: closeMenu, menuRef } = useContextMenu()
  const [ctxResult, setCtxResult] = useState<AttackResult | null>(null)
  const [ctxRequest, setCtxRequest] = useState<Request | null>(null)
  const [ctxLoading, setCtxLoading] = useState(false)
  const [addToFlowOpen, setAddToFlowOpen] = useState(false)
  const [addToOrganizerOpen, setAddToOrganizerOpen] = useState(false)

  // Stores
  const addToReplay = useProxyStore((s) => s.addToReplay)
  const replayQueue = useProxyStore((s) => s.replayQueue)
  const removeRequestFromReplay = useProxyStore((s) => s.removeRequestFromReplay)

  async function handleContextMenu(e: React.MouseEvent, result: AttackResult) {
    if (result.sentRequestId == null) return
    openMenu(e)
    setCtxResult(result)
    setCtxRequest(null)
    setCtxLoading(true)
    try {
      const req = await api.requests.get(result.sentRequestId)
      setCtxRequest(req)
    } catch {
      // keep ctxRequest null — menu items will stay disabled
    } finally {
      setCtxLoading(false)
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const f = applyFilters(results, filters)
    return [...f].sort((a, b) => {
      let diff = 0
      if (sortKey === 'index') diff = a.index - b.index
      else if (sortKey === 'status') diff = (a.status ?? -1) - (b.status ?? -1)
      else if (sortKey === 'length') diff = (a.length ?? -1) - (b.length ?? -1)
      else if (sortKey === 'time') diff = a.time - b.time
      return sortDir === 'asc' ? diff : -diff
    })
  }, [results, filters, sortKey, sortDir])

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 12,
  })

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronUp size={11} className="opacity-20" />
    return sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
  }

  function ColHeader({ col, label, className }: { col: SortKey; label: string; className?: string }) {
    return (
      <th
        className={`px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none ${className ?? ''}`}
        onClick={() => toggleSort(col)}
      >
        <span className="flex items-center gap-1">{label} <SortIcon col={col} /></span>
      </th>
    )
  }

  const inReplay = ctxRequest ? replayQueue.some((e) => e.request.id === ctxRequest.id) : false

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2">
        <span>No results yet.</span>
        <span className="text-xs">Start an attack to see results here.</span>
      </div>
    )
  }

  const cols = Math.max(markerCount, 1)

  return (
    <div className="flex h-full gap-0 overflow-hidden">
      {/* Table side */}
      <div className={`flex flex-col min-w-0 overflow-hidden transition-all duration-200 ${inspected ? 'flex-[0_0_55%]' : 'flex-1'}`}>
        {/* Filter bar */}
        <div className="flex items-center gap-2 shrink-0 pb-2">
          <button
            onClick={() => setFilterOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
              activeFilterCount > 0
                ? 'border-primary bg-primary/10 text-primary hover:bg-primary/20'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-zinc-500'
            }`}
          >
            <Filter size={12} />
            Filter
            {activeFilterCount > 0 && (
              <span className="bg-primary text-primary-foreground text-[10px] font-semibold px-1.5 py-px rounded-full leading-tight">
                {activeFilterCount}
              </span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button
              onClick={() => setFilters(defaultIntruderFilters)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset
            </button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.length.toLocaleString()} / {results.length.toLocaleString()}
          </span>
        </div>

        {/* Table */}
        <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-border">
          <div className="flex flex-col h-full">
            {/* Fixed header */}
            <table className="w-full table-fixed shrink-0">
              <colgroup>
                <col className="w-10" />
                {Array.from({ length: cols }, (_, i) => <col key={i} />)}
                <col className="w-16" />
                <col className="w-20" />
                <col className="w-16" />
              </colgroup>
              <thead className="bg-card border-b border-border">
                <tr>
                  <ColHeader col="index" label="#" />
                  {Array.from({ length: cols }, (_, i) => (
                    <th key={i} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                      {cols === 1 ? 'Payload' : `Mark ${i + 1}`}
                    </th>
                  ))}
                  <ColHeader col="status" label="Status" />
                  <ColHeader col="length" label="Length" />
                  <ColHeader col="time" label="ms" />
                </tr>
              </thead>
            </table>

            {/* Virtualized rows */}
            <div ref={parentRef} className="flex-1 overflow-auto">
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((vRow) => {
                  const r = filtered[vRow.index]
                  const isActive = inspected?.index === r.index
                  return (
                    <div
                      key={vRow.key}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vRow.start}px)`, height: `${vRow.size}px` }}
                    >
                      <table className="w-full table-fixed">
                        <colgroup>
                          <col className="w-10" />
                          {Array.from({ length: cols }, (_, i) => <col key={i} />)}
                          <col className="w-16" />
                          <col className="w-20" />
                          <col className="w-16" />
                        </colgroup>
                        <tbody>
                          <tr
                            className={`border-b border-border/50 transition-colors select-none cursor-pointer ${
                              isActive ? 'bg-primary/10' : 'hover:bg-muted/50'
                            }`}
                            onClick={() => setInspected(isActive ? null : r)}
                            onDoubleClick={() => setInspected(r)}
                            onContextMenu={(e) => handleContextMenu(e, r)}
                            title="Double-click to inspect · Right-click for actions"
                          >
                            <td className="px-3 py-2 text-xs text-muted-foreground">{r.index + 1}</td>
                            {Array.from({ length: cols }, (_, i) => (
                              <td key={i} className="px-3 py-2 text-xs font-mono truncate max-w-0" title={r.payloads[i] ?? ''}>
                                {r.payloads[i] ?? <span className="text-muted-foreground">—</span>}
                              </td>
                            ))}
                            <td className="px-3 py-2">
                              {r.error
                                ? <span className="text-xs text-red-400">Err</span>
                                : r.status != null
                                  ? <StatusBadge code={r.status} />
                                  : <span className="text-xs text-muted-foreground">—</span>
                              }
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {r.length != null ? r.length.toLocaleString() : '—'}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {r.time.toLocaleString()}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {!inspected && results.length > 0 && (
          <p className="text-[10px] text-muted-foreground/50 pt-1 text-right">
            Double-click to inspect · Right-click for actions
          </p>
        )}
      </div>

      {/* Inspector panel */}
      <div className={`flex-col min-w-0 overflow-hidden transition-all duration-200 ${inspected ? 'flex flex-[0_0_45%]' : 'hidden w-0'}`}>
        {inspected && (
          <ResultInspectorPanel
            result={inspected}
            markerCount={markerCount}
            onClose={() => setInspected(null)}
          />
        )}
      </div>

      {/* Context menu */}
      {menuOpen && ctxResult && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[220px] rounded-lg border border-border bg-card py-1 shadow-lg"
          style={{ left: 0, top: 0 }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
          {/* Loading state */}
          {ctxLoading && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Loading…
            </div>
          )}

          {/* Actions — shown once request is loaded */}
          {!ctxLoading && ctxRequest && (
            <>
              {/* Result info */}
              <div className="px-3 py-1.5 border-b border-border mb-1">
                <span className="text-[10px] text-muted-foreground font-mono">
                  #{ctxResult.index + 1} · {ctxResult.payloads.filter(Boolean).join(' / ') || 'no payload'}
                </span>
              </div>

              {/* Send to Replay */}
              {inReplay ? (
                <button
                  onClick={() => { removeRequestFromReplay(ctxRequest.id); closeMenu() }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  <RotateCcw size={14} />
                  Remove from Replay
                </button>
              ) : (
                <button
                  onClick={() => { addToReplay(ctxRequest); closeMenu() }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  <RotateCcw size={14} />
                  Send to Replay
                </button>
              )}

              {/* Send to Intruder (new session) */}
              <button
                onClick={() => { useIntruderStore.getState().addSession(ctxRequest); navigate('/intruder'); closeMenu() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <Crosshair size={14} />
                Send to Intruder
              </button>

              {/* Send to Flow */}
              <button
                onClick={() => { setAddToFlowOpen(true); closeMenu() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <GitBranch size={14} />
                Send to Flow
              </button>

              {/* Manage in Organizer */}
              <button
                onClick={() => { setAddToOrganizerOpen(true); closeMenu() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <FolderPlus size={14} />
                Manage in Organizer
              </button>

              <div className="my-1 border-t border-border" />

              {/* Copy section */}
              <div className="px-3 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Copy</span>
              </div>

              <button
                onClick={() => { copyURL(ctxRequest); closeMenu() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <Link size={14} />Copy URL
              </button>
              <button
                onClick={() => { copyRawRequest(ctxRequest); closeMenu() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <Copy size={14} />Copy Raw Request
              </button>
              <button
                onClick={() => { copyAsCurl(ctxRequest); closeMenu() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <Terminal size={14} />Copy as cURL
              </button>
              <button
                onClick={() => { copyAsFetch(ctxRequest); closeMenu() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <Code2 size={14} />Copy as fetch()
              </button>
            </>
          )}

          {/* Error state */}
          {!ctxLoading && !ctxRequest && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Could not load request data
            </div>
          )}
        </div>
      )}

      {/* Sub-modals */}
      {ctxRequest && (
        <>
          <AddToFlowModal
            open={addToFlowOpen}
            request={ctxRequest}
            onClose={() => setAddToFlowOpen(false)}
          />
          <AddToOrganizerModal
            open={addToOrganizerOpen}
            requestId={ctxRequest.id}
            onClose={() => setAddToOrganizerOpen(false)}
          />
        </>
      )}

      <IntruderFilterModal
        isOpen={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onApply={setFilters}
      />
    </div>
  )
}
