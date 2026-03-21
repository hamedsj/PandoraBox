import { useState, useEffect, useRef } from 'react'
import { X, Filter, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'search' | 'results'

export interface IntruderFilters {
  // Search
  search: string
  caseInsensitive: boolean
  useRegex: boolean
  negativeSearch: boolean
  // Status
  statusCodes: string[]   // '1xx', '2xx', '3xx', '4xx', '5xx'
  // Length
  minLen: string
  maxLen: string
  // Time
  minTime: string
  maxTime: string
  // Errors
  errors: 'all' | 'only' | 'hide'
}

export const defaultIntruderFilters: IntruderFilters = {
  search: '',
  caseInsensitive: true,
  useRegex: false,
  negativeSearch: false,
  statusCodes: [],
  minLen: '',
  maxLen: '',
  minTime: '',
  maxTime: '',
  errors: 'all',
}

const STATUS_OPTIONS = ['1xx', '2xx', '3xx', '4xx', '5xx'] as const

function countForTab(tab: Tab, f: IntruderFilters): number {
  if (tab === 'search') {
    return [f.search, !f.caseInsensitive, f.useRegex, f.negativeSearch].filter(Boolean).length
  }
  // results tab
  return [
    f.statusCodes.length > 0,
    f.minLen,
    f.maxLen,
    f.minTime,
    f.maxTime,
    f.errors !== 'all',
  ].filter(Boolean).length
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean
  onClose: () => void
  filters: IntruderFilters
  onApply: (f: IntruderFilters) => void
}

export function IntruderFilterModal({ isOpen, onClose, filters, onApply }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<Tab>('search')
  const [local, setLocal] = useState<IntruderFilters>(filters)

  useEffect(() => {
    if (isOpen) setLocal(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const localRef = useRef(local)
  useEffect(() => { localRef.current = local }, [local])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { onApply(localRef.current); onClose() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose, onApply])

  function patch<K extends keyof IntruderFilters>(key: K, value: IntruderFilters[K]) {
    setLocal(prev => ({ ...prev, [key]: value }))
  }

  function toggleArray(key: 'statusCodes', value: string) {
    setLocal(prev => {
      const arr = prev[key]
      return { ...prev, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] }
    })
  }

  const handleApply = () => { onApply(local); onClose() }
  const handleReset = () => { setLocal(defaultIntruderFilters) }
  const handleBackdrop = (e: React.MouseEvent) => { if (e.target === backdropRef.current) onClose() }

  const totalActive = (['search', 'results'] as Tab[]).reduce(
    (n, t) => n + countForTab(t, local), 0,
  )

  if (!isOpen) return null

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={handleBackdrop}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-primary" />
            <span className="text-sm font-semibold">Filter Results</span>
            {totalActive > 0 && (
              <span className="bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full font-medium">
                {totalActive} active
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border px-1">
          {(['search', 'results'] as Tab[]).map(tab => {
            const count = countForTab(tab, local)
            const active = activeTab === tab
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px',
                  active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab}
                {count > 0 && (
                  <span className={cn(
                    'text-xs px-1.5 py-px rounded-full font-semibold leading-tight',
                    active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
                  )}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        <div className="h-64 p-5 overflow-y-auto">
          {activeTab === 'search' && (
            <SearchTab local={local} patch={patch} />
          )}
          {activeTab === 'results' && (
            <ResultsTab local={local} patch={patch} toggleArray={toggleArray} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/20 rounded-b-xl">
          <button onClick={handleReset} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Reset All
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-xs text-muted-foreground select-none">⌘↵ to apply</span>
            <button onClick={onClose} className="px-3 py-1.5 rounded-md bg-muted hover:bg-muted/70 text-xs font-medium transition-colors">
              Cancel
            </button>
            <button onClick={handleApply} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors">
              Apply
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── Tab panels ───────────────────────────────────────────────────────────────

function SearchTab({
  local, patch,
}: {
  local: IntruderFilters
  patch: <K extends keyof IntruderFilters>(key: K, value: IntruderFilters[K]) => void
}) {
  const regexError: string | null = (() => {
    if (!local.useRegex || !local.search) return null
    try { new RegExp(local.search); return null }
    catch (e) { return (e as Error).message }
  })()

  return (
    <div className="flex flex-col gap-5">
      <div>
        <FieldLabel>Search in Payloads</FieldLabel>
        <TextInput
          placeholder="Filter by payload text..."
          value={local.search}
          onChange={v => patch('search', v)}
          mono={local.useRegex}
          className={regexError ? 'border-red-500 focus:ring-red-500' : undefined}
        />
        {regexError && (
          <p className="text-xs text-red-400 mt-1">{regexError}</p>
        )}
      </div>

      <div>
        <FieldLabel>Options</FieldLabel>
        <div className="divide-y divide-border/40">
          <Toggle label="Case Sensitive"  checked={!local.caseInsensitive} onChange={v => patch('caseInsensitive', !v)} />
          <Toggle label="Use Regex"       checked={local.useRegex}         onChange={v => patch('useRegex', v)} />
          <Toggle label="Invert Results"  checked={local.negativeSearch}   onChange={v => patch('negativeSearch', v)} />
        </div>
      </div>
    </div>
  )
}

function ResultsTab({
  local, patch, toggleArray,
}: {
  local: IntruderFilters
  patch: <K extends keyof IntruderFilters>(key: K, value: IntruderFilters[K]) => void
  toggleArray: (key: 'statusCodes', value: string) => void
}) {
  return (
    <div className="flex flex-col gap-5">

      {/* Status codes */}
      <div>
        <FieldLabel>Status Code</FieldLabel>
        <div className="flex gap-2 flex-wrap">
          {STATUS_OPTIONS.map(code => (
            <Chip
              key={code} label={code}
              active={local.statusCodes.includes(code)}
              activeClass={statusActiveClass(code)}
              onClick={() => toggleArray('statusCodes', code)}
            />
          ))}
        </div>
      </div>

      {/* Length range */}
      <div>
        <FieldLabel>Response Length (bytes)</FieldLabel>
        <div className="flex items-center gap-2">
          <NumberInput
            placeholder="Min"
            value={local.minLen}
            onChange={v => patch('minLen', v)}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <NumberInput
            placeholder="Max"
            value={local.maxLen}
            onChange={v => patch('maxLen', v)}
          />
        </div>
      </div>

      {/* Time range */}
      <div>
        <FieldLabel>Response Time (ms)</FieldLabel>
        <div className="flex items-center gap-2">
          <NumberInput
            placeholder="Min"
            value={local.minTime}
            onChange={v => patch('minTime', v)}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <NumberInput
            placeholder="Max"
            value={local.maxTime}
            onChange={v => patch('maxTime', v)}
          />
        </div>
      </div>

      {/* Errors */}
      <div>
        <FieldLabel>Errors</FieldLabel>
        <div className="flex gap-2">
          {(['all', 'only', 'hide'] as const).map(v => (
            <button
              key={v}
              onClick={() => patch('errors', v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors capitalize',
                local.errors === v
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground',
              )}
            >
              {local.errors === v && <Check size={10} strokeWidth={3} />}
              {v === 'all' ? 'Show All' : v === 'only' ? 'Only Errors' : 'Hide Errors'}
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{children}</p>
}

function Chip({ label, active, activeClass, onClick }: {
  label: string; active: boolean; activeClass?: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-md text-xs font-medium transition-colors border',
        active
          ? activeClass ?? 'bg-primary/20 border-primary text-primary'
          : 'bg-transparent border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

function Toggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <button onClick={() => onChange(!checked)} className="flex items-center justify-between w-full py-2 group">
      <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
      <div className={cn('w-9 h-5 rounded-full flex-shrink-0 transition-colors relative ml-2', checked ? 'bg-primary' : 'bg-muted-foreground/30')}>
        <div className={cn('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-4' : 'translate-x-0')} />
      </div>
    </button>
  )
}

function TextInput({ placeholder, value, onChange, mono, className }: {
  placeholder: string; value: string; onChange: (v: string) => void; mono?: boolean; className?: string
}) {
  return (
    <div className="relative">
      <input
        type="text" placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'w-full px-3 py-2 text-sm bg-background border border-border rounded-md',
          'focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground',
          mono && 'font-mono',
          className,
        )}
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          <X size={13} />
        </button>
      )}
    </div>
  )
}

function NumberInput({ placeholder, value, onChange }: {
  placeholder: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div className="relative flex-1">
      <input
        type="number" placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          <X size={13} />
        </button>
      )}
    </div>
  )
}

function statusActiveClass(code: string): string {
  switch (code[0]) {
    case '1': return 'bg-blue-500/20   border-blue-500/50   text-blue-400'
    case '2': return 'bg-green-500/20  border-green-500/50  text-green-400'
    case '3': return 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400'
    case '4': return 'bg-orange-500/20 border-orange-500/50 text-orange-400'
    case '5': return 'bg-red-500/20    border-red-500/50    text-red-400'
    default:  return ''
  }
}
