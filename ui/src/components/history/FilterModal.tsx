import { useState, useEffect, useRef } from 'react'
import { defaultFilters, useProxyStore } from '@/store/proxy'
import { cn } from '@/lib/utils'
import { X, Filter, Check } from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────────────────────

type Tab = 'search' | 'request' | 'response'

const SCOPE_GROUPS = [
  {
    label: 'Request',
    options: [
      { value: 'host',        label: 'Host'    },
      { value: 'path',        label: 'Path'    },
      { value: 'query',       label: 'Query'   },
      { value: 'req.headers', label: 'Headers' },
      { value: 'req.body',    label: 'Body'    },
    ],
  },
  {
    label: 'Response',
    options: [
      { value: 'res.headers', label: 'Headers' },
      { value: 'res.body',    label: 'Body'    },
    ],
  },
] as const

const STATUS_OPTIONS = ['1xx', '2xx', '3xx', '4xx', '5xx'] as const

const CONTENT_TYPE_CHIPS = [
  { label: 'JSON',     value: 'application/json' },
  { label: 'HTML',     value: 'text/html' },
  { label: 'JS',       value: 'javascript' },
  { label: 'CSS',      value: 'text/css' },
  { label: 'XML',      value: 'xml' },
  { label: 'Form',     value: 'form-urlencoded' },
  { label: 'Image',    value: 'image/' },
  { label: 'Protobuf', value: 'protobuf' },
] as const

// ─── Local state ──────────────────────────────────────────────────────────────

interface LocalFilters {
  search: string
  host: string
  extensionShow: string
  extensionShowEnabled: boolean
  extensionHide: string
  extensionHideEnabled: boolean
  contentTypeShow: string
  contentTypeShowEnabled: boolean
  contentTypeHide: string
  contentTypeHideEnabled: boolean
  statusCodes: string[]
  negativeSearch: boolean
  caseInsensitive: boolean
  useRegex: boolean
  searchScope: string[]
  inScopeOnly: boolean
}

function fromStore(f: ReturnType<typeof useProxyStore.getState>['filters']): LocalFilters {
  return {
    search:                f.search,
    host:                  f.host,
    extensionShow:         f.extensionShow,
    extensionShowEnabled:  !!f.extensionShow,
    extensionHide:         f.extensionHide,
    extensionHideEnabled:  !!f.extensionHide,
    contentTypeShow:       f.contentTypeShow,
    contentTypeShowEnabled: !!f.contentTypeShow,
    contentTypeHide:       f.contentTypeHide,
    contentTypeHideEnabled: !!f.contentTypeHide,
    statusCodes:           f.statusCodes,
    negativeSearch:        f.negativeSearch,
    caseInsensitive:       f.caseInsensitive,
    useRegex:              f.useRegex,
    searchScope:           f.searchScope,
    inScopeOnly:           f.inScopeOnly,
  }
}

function defaultLocalFilters(): LocalFilters {
  return fromStore(defaultFilters)
}

// Strip enabled flags before writing to store
function resolve(l: LocalFilters) {
  return {
    search:          l.search,
    host:            l.host,
    extensionShow:   l.extensionShowEnabled  ? l.extensionShow   : '',
    extensionHide:   l.extensionHideEnabled  ? l.extensionHide   : '',
    contentTypeShow: l.contentTypeShowEnabled ? l.contentTypeShow : '',
    contentTypeHide: l.contentTypeHideEnabled ? l.contentTypeHide : '',
    statusCodes:     l.statusCodes,
    negativeSearch:  l.negativeSearch,
    caseInsensitive: l.caseInsensitive,
    useRegex:        l.useRegex,
    searchScope:     l.searchScope,
    inScopeOnly:     l.inScopeOnly,
  }
}

function countForTab(tab: Tab, f: LocalFilters): number {
  switch (tab) {
    case 'search':
      return [f.search, f.searchScope.length > 0, f.negativeSearch, !f.caseInsensitive, f.useRegex].filter(Boolean).length
    case 'request':
      return [f.inScopeOnly, f.host, f.extensionShowEnabled && f.extensionShow, f.extensionHideEnabled && f.extensionHide].filter(Boolean).length
    case 'response':
      return [f.statusCodes.length > 0, f.contentTypeShowEnabled && f.contentTypeShow, f.contentTypeHideEnabled && f.contentTypeHide].filter(Boolean).length
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FilterModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { filters, setFilters, resetFilters } = useProxyStore()
  const backdropRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<Tab>('search')
  const [local, setLocal] = useState<LocalFilters>(() => fromStore(filters))

  useEffect(() => {
    if (isOpen) setLocal(fromStore(filters))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const localRef = useRef(local)
  useEffect(() => { localRef.current = local }, [local])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { setFilters(resolve(localRef.current)); onClose() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose, setFilters])

  function patch<K extends keyof LocalFilters>(key: K, value: LocalFilters[K]) {
    setLocal(prev => ({ ...prev, [key]: value }))
  }

  function toggleBool<K extends keyof LocalFilters>(key: K) {
    setLocal(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function toggleArray(key: 'statusCodes' | 'searchScope', value: string) {
    setLocal(prev => {
      const arr = prev[key]
      return { ...prev, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] }
    })
  }

  // Mutually exclusive enable toggle: enabling one disables the other
  function togglePair(
    enabledKey: 'extensionShowEnabled' | 'extensionHideEnabled' | 'contentTypeShowEnabled' | 'contentTypeHideEnabled',
    otherKey:   'extensionShowEnabled' | 'extensionHideEnabled' | 'contentTypeShowEnabled' | 'contentTypeHideEnabled',
  ) {
    setLocal(prev => {
      const enabling = !prev[enabledKey]
      return { ...prev, [enabledKey]: enabling, ...(enabling ? { [otherKey]: false } : {}) }
    })
  }

  const handleApply = () => { setFilters(resolve(local)); onClose() }
  const handleReset = () => { resetFilters(); setLocal(defaultLocalFilters()) }
  const handleBackdrop = (e: React.MouseEvent) => { if (e.target === backdropRef.current) onClose() }

  const totalActive = (['search', 'request', 'response'] as Tab[]).reduce(
    (n, t) => n + countForTab(t, local), 0,
  )

  if (!isOpen) return null

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={handleBackdrop}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-primary" />
            <span className="text-sm font-semibold">Filters</span>
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
          {(['search', 'request', 'response'] as Tab[]).map(tab => {
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
        <div className="h-72 p-5">
          {activeTab === 'search' && (
            <SearchTab local={local} patch={patch} toggleBool={toggleBool} toggleArray={toggleArray} />
          )}
          {activeTab === 'request' && (
            <RequestTab local={local} patch={patch} togglePair={togglePair} />
          )}
          {activeTab === 'response' && (
            <ResponseTab local={local} patch={patch} toggleArray={toggleArray} togglePair={togglePair} />
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

type PatchFn = <K extends keyof LocalFilters>(key: K, value: LocalFilters[K]) => void
type TogglePairFn = (
  enabledKey: 'extensionShowEnabled' | 'extensionHideEnabled' | 'contentTypeShowEnabled' | 'contentTypeHideEnabled',
  otherKey:   'extensionShowEnabled' | 'extensionHideEnabled' | 'contentTypeShowEnabled' | 'contentTypeHideEnabled',
) => void

function SearchTab({
  local, patch, toggleBool, toggleArray,
}: {
  local: LocalFilters
  patch: PatchFn
  toggleBool: <K extends keyof LocalFilters>(key: K) => void
  toggleArray: (key: 'statusCodes' | 'searchScope', value: string) => void
}) {
  const regexError: string | null = (() => {
    if (!local.useRegex || !local.search) return null
    try { new RegExp(local.search); return null }
    catch (e) { return (e as Error).message }
  })()

  return (
    <div className="flex flex-col gap-4">
      <div>
        <FieldLabel>Search Term</FieldLabel>
        <TextInput
          placeholder="Search across selected fields..."
          value={local.search}
          onChange={v => patch('search', v)}
          mono={local.useRegex}
          className={regexError ? 'border-red-500 focus:ring-red-500' : undefined}
        />
        {regexError && (
          <p className="text-xs text-red-400 mt-1">{regexError}</p>
        )}
      </div>

      <div className="flex gap-6">
        {/* Scope */}
        <div className="flex-1 min-w-0">
          <FieldLabel>Scope <span className="font-normal normal-case tracking-normal text-muted-foreground">— none = all</span></FieldLabel>
          <div className="space-y-2">
            {SCOPE_GROUPS.map(group => (
              <div key={group.label} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-14 text-right flex-shrink-0">{group.label}</span>
                <div className="flex flex-wrap gap-1">
                  {group.options.map(({ value, label }) => (
                    <Chip
                      key={value}
                      label={label}
                      active={local.searchScope.includes(value)}
                      onClick={() => toggleArray('searchScope', value)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="w-px bg-border flex-shrink-0" />

        {/* Options */}
        <div className="w-48 flex-shrink-0">
          <FieldLabel>Options</FieldLabel>
          <div className="divide-y divide-border/40">
            <Toggle label="Case Sensitive" checked={!local.caseInsensitive} onChange={v => patch('caseInsensitive', !v)} />
            <Toggle label="Use Regex"      checked={local.useRegex}         onChange={v => patch('useRegex', v)} />
            <Toggle label="Invert Results" checked={local.negativeSearch}   onChange={() => toggleBool('negativeSearch')} />
          </div>
        </div>
      </div>
    </div>
  )
}

function RequestTab({ local, patch, togglePair }: { local: LocalFilters; patch: PatchFn; togglePair: TogglePairFn }) {
  return (
    <div className="flex flex-col gap-5">
      <Toggle
        label="Only show in-scope items"
        checked={local.inScopeOnly}
        onChange={v => patch('inScopeOnly', v)}
      />
      <div>
        <FieldLabel>Host</FieldLabel>
        <TextInput placeholder="e.g. api.example.com" value={local.host} onChange={v => patch('host', v)} />
      </div>

      <div>
        <FieldLabel>File Extension</FieldLabel>
        <div className="space-y-2">
          <LabeledInput
            label="Only Show" placeholder="e.g. php, json" mono intent="show"
            value={local.extensionShow} onChange={v => patch('extensionShow', v)}
            enabled={local.extensionShowEnabled}
            onToggle={() => togglePair('extensionShowEnabled', 'extensionHideEnabled')}
          />
          <LabeledInput
            label="Hide" placeholder="e.g. js, css, png" mono intent="hide"
            value={local.extensionHide} onChange={v => patch('extensionHide', v)}
            enabled={local.extensionHideEnabled}
            onToggle={() => togglePair('extensionHideEnabled', 'extensionShowEnabled')}
          />
        </div>
      </div>
    </div>
  )
}

function ResponseTab({
  local, patch, toggleArray, togglePair,
}: {
  local: LocalFilters
  patch: PatchFn
  toggleArray: (key: 'statusCodes' | 'searchScope', value: string) => void
  togglePair: TogglePairFn
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <FieldLabel>Status Code</FieldLabel>
        <div className="flex gap-2">
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

      <div>
        <FieldLabel>Content-Type</FieldLabel>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {CONTENT_TYPE_CHIPS.map(({ label, value }) => (
            <Chip
              key={label} label={label}
              active={local.contentTypeShow === value && local.contentTypeShowEnabled}
              onClick={() => {
                const selecting = local.contentTypeShow !== value || !local.contentTypeShowEnabled
                patch('contentTypeShow', selecting ? value : '')
                if (selecting) {
                  patch('contentTypeShowEnabled', true)
                  patch('contentTypeHideEnabled', false)
                }
              }}
            />
          ))}
        </div>
        <div className="space-y-2">
          <LabeledInput
            label="Only Show" placeholder="e.g. application/json" mono intent="show"
            value={local.contentTypeShow} onChange={v => patch('contentTypeShow', v)}
            enabled={local.contentTypeShowEnabled}
            onToggle={() => togglePair('contentTypeShowEnabled', 'contentTypeHideEnabled')}
          />
          <LabeledInput
            label="Hide" placeholder="e.g. text/css" mono intent="hide"
            value={local.contentTypeHide} onChange={v => patch('contentTypeHide', v)}
            enabled={local.contentTypeHideEnabled}
            onToggle={() => togglePair('contentTypeHideEnabled', 'contentTypeShowEnabled')}
          />
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

function LabeledInput({ label, placeholder, value, onChange, intent, mono, enabled, onToggle }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void
  intent: 'show' | 'hide'; mono?: boolean; enabled: boolean; onToggle: () => void
}) {
  const isShow = intent === 'show'
  return (
    <div className="flex items-center gap-2.5">
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className={cn(
          'w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors',
          enabled
            ? isShow ? 'bg-green-500 border-green-500' : 'bg-red-500 border-red-500'
            : 'border-border bg-transparent hover:border-muted-foreground',
        )}
      >
        {enabled && <Check size={9} className="text-white" strokeWidth={3} />}
      </button>

      {/* Label */}
      <span className={cn(
        'text-xs font-medium w-20 text-right flex-shrink-0 transition-colors',
        enabled ? isShow ? 'text-green-400' : 'text-red-400' : 'text-muted-foreground',
      )}>
        {label}
      </span>

      {/* Input */}
      <div className="relative flex-1">
        <input
          type="text" placeholder={placeholder} value={value}
          onChange={e => onChange(e.target.value)}
          disabled={!enabled}
          className={cn(
            'w-full px-3 py-1.5 text-sm bg-background border rounded-md transition-colors',
            'focus:outline-none focus:ring-1 placeholder:text-muted-foreground',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            mono && 'font-mono',
            enabled
              ? isShow
                ? 'border-green-500/40 focus:ring-green-500/40 focus:border-green-500/60'
                : 'border-red-500/40 focus:ring-red-500/40 focus:border-red-500/60'
              : 'border-border',
          )}
        />
        {value && enabled && (
          <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X size={13} />
          </button>
        )}
      </div>
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
