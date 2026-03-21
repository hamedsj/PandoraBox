import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  RadioTower, Play, Square, Trash2, Plus, Copy, Check, ChevronDown,
  Loader2, Filter, Globe, Mail, Server, Zap, AlertCircle, Clock,
  ArrowUpRight, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCollaboratorStore, PUBLIC_SERVERS } from '@/store/collaborator'
import { CollaboratorFilterModal, defaultCollaboratorFilters } from '@/components/collaborator/CollaboratorFilterModal'
import type { CollaboratorFilters } from '@/components/collaborator/CollaboratorFilterModal'
import type { Interaction } from '@/lib/interactsh'

// ─── Protocol config ──────────────────────────────────────────────────────────

function protocolMeta(protocol: string) {
  const p = protocol.toLowerCase()
  if (p === 'dns') return { label: 'DNS',  icon: Globe,  bg: 'bg-violet-500/15', text: 'text-violet-400', border: 'border-violet-500/30', dot: 'bg-violet-400' }
  if (p === 'http' || p === 'https') return { label: 'HTTP', icon: ArrowUpRight, bg: 'bg-blue-500/15',   text: 'text-blue-400',   border: 'border-blue-500/30',   dot: 'bg-blue-400' }
  if (p === 'smtp' || p === 'smtps') return { label: 'SMTP', icon: Mail,         bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30', dot: 'bg-orange-400' }
  if (p === 'ldap' || p === 'ldaps') return { label: 'LDAP', icon: Server,       bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/30', dot: 'bg-yellow-400' }
  if (p === 'ftp')  return { label: 'FTP',  icon: Server,  bg: 'bg-pink-500/15',  text: 'text-pink-400',  border: 'border-pink-500/30',  dot: 'bg-pink-400' }
  return { label: protocol.toUpperCase(), icon: Zap, bg: 'bg-zinc-500/15', text: 'text-zinc-400', border: 'border-zinc-500/30', dot: 'bg-zinc-400' }
}

function ProtocolBadge({ protocol, size = 'md' }: { protocol: string; size?: 'sm' | 'md' }) {
  const meta = protocolMeta(protocol)
  const Icon = meta.icon
  return (
    <span className={cn(
      'inline-flex items-center gap-1 font-medium rounded border',
      meta.bg, meta.text, meta.border,
      size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5',
    )}>
      <Icon size={size === 'sm' ? 9 : 11} />
      {meta.label}
    </span>
  )
}

// ─── Time formatting ──────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const delta = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (delta < 5)   return 'just now'
  if (delta < 60)  return `${delta}s ago`
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
  return `${Math.floor(delta / 86400)}d ago`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

// ─── Filtering ────────────────────────────────────────────────────────────────

function applyFilters(interactions: Interaction[], f: CollaboratorFilters): Interaction[] {
  return interactions.filter((i) => {
    const proto = i.protocol.toLowerCase()

    // Protocol filter
    if (f.protocols.length > 0) {
      const matched = f.protocols.some((fp) => {
        if (fp === 'smtp') return proto === 'smtp' || proto === 'smtps'
        if (fp === 'http') return proto === 'http' || proto === 'https'
        return proto === fp
      })
      if (!matched) return false
    }

    // DNS type filter
    if (f.dnsTypes.length > 0 && proto === 'dns') {
      if (!i['q-type'] || !f.dnsTypes.includes(i['q-type'].toUpperCase())) return false
    }

    // Search
    if (f.search) {
      const needle = f.caseInsensitive ? f.search.toLowerCase() : f.search
      const haystack = [
        i['remote-address'],
        i['raw-request'] ?? '',
        i['raw-response'] ?? '',
        i['full-id'] ?? '',
        i['smtp-from'] ?? '',
        i['q-type'] ?? '',
      ].map(s => f.caseInsensitive ? s.toLowerCase() : s).join(' ')
      const match = haystack.includes(needle)
      if (f.negativeSearch ? match : !match) return false
    }

    return true
  })
}

function countActiveFilters(f: CollaboratorFilters): number {
  return [
    f.search,
    !f.caseInsensitive,
    f.negativeSearch,
    f.protocols.length > 0,
    f.dnsTypes.length > 0,
    f.errorsOnly,
  ].filter(Boolean).length
}

// ─── Copy hook ────────────────────────────────────────────────────────────────

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    })
  }, [])
  return { copy, copied }
}

// ─── Interaction row ──────────────────────────────────────────────────────────

function InteractionRow({
  interaction,
  isSelected,
  onClick,
  ticker,
}: {
  interaction: Interaction
  isSelected: boolean
  onClick: () => void
  ticker: number   // force re-render for time updates
}) {
  void ticker
  const meta = protocolMeta(interaction.protocol)
  const proto = interaction.protocol.toLowerCase()

  const typeLabel = proto === 'dns'
    ? (interaction['q-type'] ?? 'DNS')
    : proto === 'http' || proto === 'https'
      ? (interaction['raw-request']?.split(' ')?.[0] ?? 'HTTP')
      : proto === 'smtp'
        ? (interaction['smtp-from'] ? `FROM: ${interaction['smtp-from']}` : 'SMTP')
        : meta.label

  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-border/50 transition-colors select-none group',
        isSelected ? 'bg-primary/10' : 'hover:bg-muted/40',
      )}
    >
      {/* Protocol dot */}
      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', meta.dot)} />

      {/* Protocol badge */}
      <ProtocolBadge protocol={interaction.protocol} size="sm" />

      {/* Type label */}
      <span className="text-xs font-mono text-muted-foreground w-16 shrink-0 truncate" title={typeLabel}>
        {typeLabel}
      </span>

      {/* Remote address */}
      <span className="text-xs font-mono text-foreground flex-1 truncate" title={interaction['remote-address']}>
        {interaction['remote-address']}
      </span>

      {/* Time */}
      <span className="text-xs text-muted-foreground shrink-0 tabular-nums" title={formatTime(interaction.timestamp)}>
        {timeAgo(interaction.timestamp)}
      </span>
    </div>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ interaction, onClose }: { interaction: Interaction; onClose: () => void }) {
  const meta = protocolMeta(interaction.protocol)
  const proto = interaction.protocol.toLowerCase()
  const { copy, copied } = useCopy()

  const typeLabel = proto === 'dns'
    ? (interaction['q-type'] ?? '—')
    : proto === 'http' || proto === 'https'
      ? (interaction['raw-request']?.split(' ')?.[0] ?? '—')
      : proto === 'smtp'
        ? 'MAIL'
        : meta.label

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Detail header */}
      <div className={cn('shrink-0 px-4 py-3 border-b border-border', meta.bg)}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <ProtocolBadge protocol={interaction.protocol} />
            <span className={cn('text-xs font-mono font-semibold px-2 py-0.5 rounded border', meta.bg, meta.text, meta.border)}>
              {typeLabel}
            </span>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
          <MetaItem label="IP" value={interaction['remote-address']} mono />
          <MetaItem label="Time" value={formatTime(interaction.timestamp)} />
          {interaction['full-id'] && <MetaItem label="Host" value={interaction['full-id']} mono />}
          {interaction['smtp-from'] && <MetaItem label="From" value={interaction['smtp-from']} mono />}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* DNS-specific info */}
        {proto === 'dns' && interaction['q-type'] && (
          <div className="px-4 pt-3 pb-1">
            <SectionLabel>Query</SectionLabel>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn('text-xs font-mono font-semibold px-2 py-0.5 rounded border', meta.bg, meta.text, meta.border)}>
                {interaction['q-type']}
              </span>
              <span className="text-xs font-mono text-foreground/80">{interaction['full-id']}</span>
            </div>
          </div>
        )}

        {/* Raw Request */}
        {interaction['raw-request'] && (
          <RawSection
            label="Raw Request"
            value={interaction['raw-request']}
            onCopy={() => copy(interaction['raw-request']!, 'req')}
            copied={copied === 'req'}
          />
        )}

        {/* Raw Response */}
        {interaction['raw-response'] && (
          <RawSection
            label="Raw Response"
            value={interaction['raw-response']}
            onCopy={() => copy(interaction['raw-response']!, 'res')}
            copied={copied === 'res'}
          />
        )}

        {/* No content fallback */}
        {!interaction['raw-request'] && !interaction['raw-response'] && (
          <div className="px-4 py-6 text-sm text-muted-foreground italic">
            No request / response data available for this interaction.
          </div>
        )}
      </div>
    </div>
  )
}

function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn('text-xs text-foreground/90', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{children}</p>
}

function RawSection({ label, value, onCopy, copied }: {
  label: string; value: string; onCopy: () => void; copied: boolean
}) {
  return (
    <div className="px-4 pt-3 pb-2">
      <div className="flex items-center justify-between mb-1.5">
        <SectionLabel>{label}</SectionLabel>
        <button
          onClick={onCopy}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed bg-muted/30 rounded-md p-3 border border-border/50 select-text max-h-72 overflow-y-auto">
        {value}
      </pre>
    </div>
  )
}

// ─── Empty states ─────────────────────────────────────────────────────────────

function NoSelectionPanel() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
      <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center">
        <RadioTower size={22} className="text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">Select an interaction</p>
      <p className="text-xs text-muted-foreground max-w-[200px]">
        Click any row in the list to inspect its full request and response details
      </p>
    </div>
  )
}

// ─── Server selector ──────────────────────────────────────────────────────────

function ServerSelector({ value, onChange, disabled }: {
  value: string; onChange: (s: string) => void; disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-mono transition-colors',
          disabled
            ? 'border-border text-muted-foreground opacity-50 cursor-not-allowed'
            : 'border-border text-muted-foreground hover:text-foreground hover:border-zinc-500 cursor-pointer',
        )}
      >
        <Globe size={11} />
        {value}
        <ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-border bg-card shadow-lg py-1">
            {PUBLIC_SERVERS.map(s => (
              <button
                key={s}
                onClick={() => { onChange(s); setOpen(false) }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-xs font-mono text-left transition-colors',
                  s === value ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {s === value && <Check size={10} />}
                {s}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function CollaboratorPage() {
  const {
    host, server, status, error,
    interactions, lastPollAt,
    start, stop, clear, setServer,
  } = useCollaboratorStore()

  const [selected, setSelected] = useState<Interaction | null>(null)
  const [filters, setFilters] = useState<CollaboratorFilters>(defaultCollaboratorFilters)
  const [filterOpen, setFilterOpen] = useState(false)
  const [ticker, setTicker] = useState(0)

  const parentRef = useRef<HTMLDivElement>(null)
  const { copy, copied } = useCopy()

  // Tick every 15s to refresh relative timestamps
  useEffect(() => {
    const t = setInterval(() => setTicker(n => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  const filtered = useMemo(() => applyFilters(interactions, filters), [interactions, filters])
  const activeFilterCount = countActiveFilters(filters)

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
    overscan: 10,
  })

  // De-select if filtered item disappears
  useEffect(() => {
    if (selected && !filtered.includes(selected)) setSelected(null)
  }, [filtered, selected])

  // Auto-scroll to top on new interaction
  const prevCount = useRef(interactions.length)
  useEffect(() => {
    if (interactions.length > prevCount.current && parentRef.current) {
      parentRef.current.scrollTop = 0
    }
    prevCount.current = interactions.length
  }, [interactions.length])

  const isRunning = status === 'active'
  const isConnecting = status === 'connecting'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">

          {/* Icon + title */}
          <div className="flex items-center gap-2">
            <div className={cn(
              'w-7 h-7 rounded-md flex items-center justify-center shrink-0',
              isRunning ? 'bg-emerald-500/20' : isConnecting ? 'bg-amber-500/20' : 'bg-muted',
            )}>
              {isConnecting
                ? <Loader2 size={14} className="text-amber-400 animate-spin" />
                : <RadioTower size={14} className={isRunning ? 'text-emerald-400' : 'text-muted-foreground'} />
              }
            </div>
            <span className="text-sm font-semibold">Collaborator</span>
            {/* Status pill */}
            <span className={cn(
              'text-[10px] font-semibold px-2 py-0.5 rounded-full border leading-tight',
              isRunning    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' :
              isConnecting ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' :
              status === 'error' ? 'bg-red-500/15 border-red-500/30 text-red-400' :
              'bg-muted border-border text-muted-foreground',
            )}>
              {isRunning ? '● Active' : isConnecting ? '◌ Connecting…' : status === 'error' ? '✕ Error' : '○ Idle'}
            </span>
          </div>

          {/* Server selector */}
          <ServerSelector value={server} onChange={setServer} disabled={isRunning || isConnecting} />

          {/* Spacer */}
          <div className="flex-1" />

          {/* Controls */}
          <div className="flex items-center gap-2">
            {isRunning || isConnecting ? (
              <button
                onClick={stop}
                disabled={isConnecting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <Square size={11} />
                Stop
              </button>
            ) : (
              <button
                onClick={() => start()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 text-xs font-medium transition-colors"
              >
                <Play size={11} />
                Start
              </button>
            )}

            {isRunning && (
              <button
                onClick={() => { stop().then(() => start()) }}
                title="Generate a new session with a fresh host"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-zinc-500 text-xs transition-colors"
              >
                <Plus size={11} />
                New Session
              </button>
            )}

            <button
              onClick={clear}
              disabled={interactions.length === 0}
              title="Clear all interactions"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-zinc-500 text-xs transition-colors disabled:opacity-40"
            >
              <Trash2 size={11} />
              Clear
            </button>
          </div>
        </div>

        {/* ── Host bar ─────────────────────────────────────────────────────── */}
        {host && (
          <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-border/50 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Your Host</span>
              <span className="text-sm font-mono text-foreground truncate">{host}</span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Copy host */}
              <CopyButton label="Host" value={host} copyKey="host" copied={copied} onCopy={copy} />
              {/* Copy HTTP URL */}
              <CopyButton label="HTTP URL" value={`http://${host}`} copyKey="http" copied={copied} onCopy={copy} />
              {/* Copy DNS payload */}
              <CopyButton label="DNS Lookup" value={`nslookup ${host}`} copyKey="dns" copied={copied} onCopy={copy} />
              {/* Copy curl */}
              <CopyButton label="cURL" value={`curl http://${host}`} copyKey="curl" copied={copied} onCopy={copy} />
            </div>

            {/* Last poll */}
            {lastPollAt && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 shrink-0">
                <RefreshCw size={9} />
                <span>polled {timeAgo(lastPollAt)}</span>
              </div>
            )}
          </div>
        )}

        {/* Error state */}
        {status === 'error' && error && (
          <div className="flex items-center gap-2 mt-2 p-2 rounded-md bg-red-500/10 border border-red-500/20">
            <AlertCircle size={13} className="text-red-400 shrink-0" />
            <p className="text-xs text-red-400">{error}</p>
            <button
              onClick={() => start()}
              className="ml-auto text-xs text-red-400 hover:text-red-300 underline"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      {status === 'idle' && interactions.length === 0 ? (
        <IdleEmptyState onStart={() => start()} />
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── LEFT: interaction list ──────────────────────────────────────── */}
          <div className="flex flex-col w-[340px] shrink-0 border-r border-border overflow-hidden">

            {/* Filter bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
              <button
                onClick={() => setFilterOpen(true)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors',
                  activeFilterCount > 0
                    ? 'border-primary bg-primary/10 text-primary hover:bg-primary/20'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-zinc-500',
                )}
              >
                <Filter size={11} />
                Filter
                {activeFilterCount > 0 && (
                  <span className="bg-primary text-primary-foreground text-[10px] font-semibold px-1.5 py-px rounded-full leading-tight">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {activeFilterCount > 0 && (
                <button
                  onClick={() => setFilters(defaultCollaboratorFilters)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Reset
                </button>
              )}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {filtered.length.toLocaleString()}{filtered.length !== interactions.length ? ` / ${interactions.length.toLocaleString()}` : ''} interaction{filtered.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Stats chips */}
            {interactions.length > 0 && (
              <ProtocolStats interactions={interactions} />
            )}

            {/* Virtualized list */}
            {filtered.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-2">
                {interactions.length === 0 ? (
                  <>
                    <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center">
                      <Clock size={18} className="text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">Waiting for interactions…</p>
                    <p className="text-xs text-muted-foreground">
                      Send your host to a target and any DNS, HTTP or SMTP callbacks will appear here
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">No matching interactions</p>
                    <button
                      onClick={() => setFilters(defaultCollaboratorFilters)}
                      className="text-xs text-primary hover:underline"
                    >
                      Clear filters
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div ref={parentRef} className="flex-1 overflow-auto">
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                  {rowVirtualizer.getVirtualItems().map(vRow => {
                    const interaction = filtered[vRow.index]
                    return (
                      <div
                        key={vRow.key}
                        style={{
                          position: 'absolute', top: 0, left: 0, width: '100%',
                          transform: `translateY(${vRow.start}px)`,
                          height: `${vRow.size}px`,
                        }}
                      >
                        <InteractionRow
                          interaction={interaction}
                          isSelected={selected === interaction}
                          onClick={() => setSelected(prev => prev === interaction ? null : interaction)}
                          ticker={ticker}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT: detail panel ─────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {selected ? (
              <DetailPanel
                interaction={selected}
                onClose={() => setSelected(null)}
              />
            ) : (
              <NoSelectionPanel />
            )}
          </div>
        </div>
      )}

      {/* Filter modal */}
      <CollaboratorFilterModal
        isOpen={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onApply={setFilters}
      />
    </div>
  )
}

// ─── Protocol stats chips ─────────────────────────────────────────────────────

function ProtocolStats({ interactions }: { interactions: Interaction[] }) {
  const counts: Record<string, number> = {}
  for (const i of interactions) {
    const p = i.protocol.toLowerCase()
    const key = p === 'https' ? 'http' : p === 'smtps' ? 'smtp' : p
    counts[key] = (counts[key] ?? 0) + 1
  }

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/50 flex-wrap shrink-0">
      {entries.map(([proto, count]) => {
        const meta = protocolMeta(proto)
        return (
          <span
            key={proto}
            className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', meta.bg, meta.text, meta.border)}
          >
            {proto.toUpperCase()} {count}
          </span>
        )
      })}
    </div>
  )
}

// ─── Copy button helper ───────────────────────────────────────────────────────

function CopyButton({
  label, value, copyKey, copied, onCopy,
}: {
  label: string; value: string; copyKey: string
  copied: string | null; onCopy: (v: string, k: string) => void
}) {
  const isCopied = copied === copyKey
  return (
    <button
      onClick={() => onCopy(value, copyKey)}
      title={value}
      className={cn(
        'flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors font-medium',
        isCopied
          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
          : 'border-border text-muted-foreground hover:text-foreground hover:border-zinc-500',
      )}
    >
      {isCopied ? <Check size={10} /> : <Copy size={10} />}
      {isCopied ? 'Copied!' : label}
    </button>
  )
}

// ─── Idle empty state ─────────────────────────────────────────────────────────

function IdleEmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
      {/* Animated radar rings */}
      <div className="relative flex items-center justify-center">
        <div className="absolute w-32 h-32 rounded-full border border-primary/10 animate-ping" style={{ animationDuration: '3s' }} />
        <div className="absolute w-20 h-20 rounded-full border border-primary/15 animate-ping" style={{ animationDuration: '3s', animationDelay: '1s' }} />
        <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
          <RadioTower size={26} className="text-primary" />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-foreground">Out-of-Band Collaborator</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Generate a unique host and detect DNS, HTTP, and SMTP callbacks from blind vulnerabilities — SSRF, XXE, RCE, and more.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 max-w-md w-full">
        <FeatureCard icon={Globe} label="DNS" desc="A, AAAA, MX, TXT, NS callbacks" color="text-violet-400" />
        <FeatureCard icon={ArrowUpRight} label="HTTP" desc="Full request & response capture" color="text-blue-400" />
        <FeatureCard icon={Mail} label="SMTP / MX" desc="Mail server interaction detection" color="text-orange-400" />
      </div>

      <button
        onClick={onStart}
        className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors shadow-md"
      >
        <Play size={14} />
        Start Listening
      </button>

      <p className="text-xs text-muted-foreground">
        Powered by{' '}
        <span className="text-foreground font-medium">interactsh</span>
        {' '}public servers
      </p>
    </div>
  )
}

function FeatureCard({ icon: Icon, label, desc, color }: {
  icon: typeof Globe; label: string; desc: string; color: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border bg-card text-center">
      <Icon size={18} className={color} />
      <span className="text-xs font-semibold text-foreground">{label}</span>
      <span className="text-[10px] text-muted-foreground leading-tight">{desc}</span>
    </div>
  )
}
