import { useState, useRef, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { StatusBadge } from '@/components/common/StatusBadge'
import type { AttackResult } from '@/store/intruder'

type SortKey = 'index' | 'status' | 'length' | 'time'
type SortDir = 'asc' | 'desc'

interface Props {
  results: AttackResult[]
  markerCount: number
}

function filterResults(results: AttackResult[], statusFilter: string, minLen: string, maxLen: string): AttackResult[] {
  return results.filter((r) => {
    if (statusFilter) {
      const codes = statusFilter.split(',').map((s) => s.trim()).filter(Boolean)
      if (r.status == null) return false
      if (!codes.some((c) => String(r.status).startsWith(c.replace('x', '').replace('X', '')))) return false
    }
    if (minLen && r.length != null && r.length < Number(minLen)) return false
    if (maxLen && r.length != null && r.length > Number(maxLen)) return false
    return true
  })
}

export function ResultsTable({ results, markerCount }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<AttackResult | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('index')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [statusFilter, setStatusFilter] = useState('')
  const [minLen, setMinLen] = useState('')
  const [maxLen, setMaxLen] = useState('')

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const f = filterResults(results, statusFilter, minLen, maxLen)
    return [...f].sort((a, b) => {
      let diff = 0
      if (sortKey === 'index') diff = a.index - b.index
      else if (sortKey === 'status') diff = (a.status ?? -1) - (b.status ?? -1)
      else if (sortKey === 'length') diff = (a.length ?? -1) - (b.length ?? -1)
      else if (sortKey === 'time') diff = a.time - b.time
      return sortDir === 'asc' ? diff : -diff
    })
  }, [results, statusFilter, minLen, maxLen, sortKey, sortDir])

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
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

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2">
        <span>No results yet.</span>
        <span className="text-xs">Start an attack to see results here.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <input
          type="text"
          placeholder="Status (e.g. 200, 5xx)"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <input
          type="number"
          placeholder="Min length"
          value={minLen}
          onChange={(e) => setMinLen(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <input
          type="number"
          placeholder="Max length"
          value={maxLen}
          onChange={(e) => setMaxLen(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length.toLocaleString()} / {results.length.toLocaleString()} results
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-border">
        <div className="flex flex-col h-full">
          {/* Header */}
          <table className="w-full table-fixed shrink-0">
            <colgroup>
              <col className="w-12" />
              {Array.from({ length: Math.max(markerCount, 1) }, (_, i) => (
                <col key={i} />
              ))}
              <col className="w-20" />
              <col className="w-24" />
              <col className="w-20" />
            </colgroup>
            <thead className="bg-card border-b border-border">
              <tr>
                <ColHeader col="index" label="#" />
                {Array.from({ length: Math.max(markerCount, 1) }, (_, i) => (
                  <th key={i} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    {markerCount <= 1 ? 'Payload' : `Marker ${i + 1}`}
                  </th>
                ))}
                <ColHeader col="status" label="Status" />
                <ColHeader col="length" label="Length" />
                <ColHeader col="time" label="Time (ms)" />
              </tr>
            </thead>
          </table>

          {/* Virtualized body */}
          <div ref={parentRef} className="flex-1 overflow-auto">
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const r = filtered[vRow.index]
                const isSelected = selected?.index === r.index
                return (
                  <div
                    key={vRow.key}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vRow.start}px)`, height: `${vRow.size}px` }}
                  >
                    <table className="w-full table-fixed">
                      <colgroup>
                        <col className="w-12" />
                        {Array.from({ length: Math.max(markerCount, 1) }, (_, i) => (
                          <col key={i} />
                        ))}
                        <col className="w-20" />
                        <col className="w-24" />
                        <col className="w-20" />
                      </colgroup>
                      <tbody>
                        <tr
                          className={`cursor-pointer transition-colors border-b border-border/50 ${
                            isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
                          }`}
                          onClick={() => setSelected(isSelected ? null : r)}
                        >
                          <td className="px-3 py-2 text-xs text-muted-foreground">{r.index + 1}</td>
                          {Array.from({ length: Math.max(markerCount, 1) }, (_, i) => (
                            <td key={i} className="px-3 py-2 text-xs font-mono truncate max-w-0">
                              {r.payloads[i] ?? '—'}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            {r.error ? (
                              <span className="text-xs text-red-400">Error</span>
                            ) : r.status != null ? (
                              <StatusBadge code={r.status} />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
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

      {/* Detail panel */}
      {selected && (
        <div className="shrink-0 rounded-md border border-border bg-card p-3 max-h-48 overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-foreground">Result #{selected.index + 1}</span>
            <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X size={13} />
            </button>
          </div>
          {selected.error && (
            <p className="text-xs text-red-400 font-mono">{selected.error}</p>
          )}
          {!selected.error && (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex gap-4">
                <span className="text-muted-foreground">Status:</span>
                <span>{selected.status ?? '—'}</span>
                <span className="text-muted-foreground ml-4">Length:</span>
                <span>{selected.length?.toLocaleString() ?? '—'}</span>
                <span className="text-muted-foreground ml-4">Time:</span>
                <span>{selected.time}ms</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {selected.payloads.map((p, i) => (
                  <span key={i} className="font-mono bg-muted px-1.5 py-0.5 rounded">
                    {markerCount > 1 ? `[${i + 1}] ` : ''}{p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
