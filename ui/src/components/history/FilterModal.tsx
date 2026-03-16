import { useState, useEffect, useRef } from 'react'
import { useProxyStore } from '@/store/proxy'
import { cn } from '@/lib/utils'
import { X, Filter } from 'lucide-react'

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

// ─── Local filter state ───────────────────────────────────────────────────────

interface LocalFilters {
  search: string
  host: string
  extensionShow: string
  extensionHide: string
  contentTypeShow: string
  contentTypeHide: string
  statusCodes: string[]
  negativeSearch: boolean
  caseInsensitive: boolean
  useRegex: boolean
  searchScope: string[]
}

function fromStore(filters: ReturnType<typeof useProxyStore.getState>['filters']): LocalFilters {
  return {
    search:          filters.search,
    host:            filters.host,
    extensionShow:   filters.extensionShow,
    extensionHide:   filters.extensionHide,
    contentTypeShow: filters.contentTypeShow,
    contentTypeHide: filters.contentTypeHide,
    statusCodes:     filters.statusCodes,
    negativeSearch:  filters.negativeSearch,
    caseInsensitive: filters.caseInsensitive,
    useRegex:        filters.useRegex,
    searchScope:     filters.searchScope,
  }
}

function empty(): LocalFilters {
  return {
    search: '', host: '', extensionShow: '', extensionHide: '',
    contentTypeShow: '', contentTypeHide: '',
    statusCodes: [], negativeSearch: false,
    caseInsensitive: true, useRegex: false, searchScope: [],
  }
}

function countForTab(tab: Tab, f: LocalFilters): number {
  switch (tab) {
    case 'search':
      return [f.search, f.searchScope.length > 0, f.negativeSearch, !f.caseInsensitive, f.useRegex].filter(Boolean).length
    case 'request':
      return [f.host, f.extensionShow, f.extensionHide].filter(Boolean).length
    case 'response':
      return [f.statusCodes.length > 0, f.contentTypeShow, f.contentTypeHide].filter(Boolean).length
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { setFilters(localRef.current); onClose() }
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

  const handleApply = () => { setFilters(local); onClose() }
  const handleReset = () => { resetFilters(); setLocal(empty()) }
  const handleBackdrop = (e: React.MouseEvent) => { if (e.target === backdropRef.current) onClose() }

  const totalActive = (['search', 'request', 'response'] as Tab[]).reduce(
    (n, t) => n + countForTab(t, local), 0
  )

  if (!isOpen) return null

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={handleBackdrop}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg flex flex-col">

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
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
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

        {/* Tab content — fixed height, no scroll */}
        <div className="h-72 p-5">
          {activeTab === 'search' && <SearchTab local={local} patch={patch} toggleBool={toggleBool} toggleArray={toggleArray} />}
          {activeTab === 'request' && <RequestTab local={local} patch={patch} />}
          {activeTab === 'response' && <ResponseTab local={local} patch={patch} toggleArray={toggleArray} />}
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

function SearchTab({
  local, patch, toggleBool, toggleArray,
}: {
  local: LocalFilters
  patch: PatchFn
  toggleBool: <K extends keyof LocalFilters>(key: K) => void
  toggleArray: (key: 'statusCodes' | 'searchScope', value: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Search term — full width */}
      <div>
        <FieldLabel>Search Term</FieldLabel>
        <TextInput
          placeholder="Search across selected fields..."
          value={local.search}
          onChange={v => patch('search', v)}
        />
      </div>

      {/* Scope + Options — side by side */}
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

        {/* Divider */}
        <div className="w-px bg-border flex-shrink-0" />

        {/* Options */}
        <div className="w-44 flex-shrink-0">
          <FieldLabel>Options</FieldLabel>
          <div className="divide-y divide-border/40">
            <Toggle label="Case Sensitive"     checked={!local.caseInsensitive} onChange={v => patch('caseInsensitive', !v)} />
            <Toggle label="Regular Expression"  checked={local.useRegex}         onChange={v => patch('useRegex', v)} />
            <Toggle label="Invert Results"     checked={local.negativeSearch}    onChange={() => toggleBool('negativeSearch')} />
          </div>
        </div>
      </div>
    </div>
  )
}

function RequestTab({ local, patch }: { local: LocalFilters; patch: PatchFn }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <FieldLabel>Host</FieldLabel>
        <TextInput
          placeholder="e.g. api.example.com"
          value={local.host}
          onChange={v => patch('host', v)}
        />
      </div>

      <div>
        <FieldLabel>File Extension</FieldLabel>
        <div className="space-y-2">
          <LabeledInput label="Only Show" placeholder="e.g. php, json"       value={local.extensionShow} onChange={v => patch('extensionShow', v)} intent="show" mono />
          <LabeledInput label="Hide"      placeholder="e.g. js, css, png"    value={local.extensionHide} onChange={v => patch('extensionHide', v)} intent="hide" mono />
        </div>
      </div>
    </div>
  )
}

function ResponseTab({
  local, patch, toggleArray,
}: {
  local: LocalFilters
  patch: PatchFn
  toggleArray: (key: 'statusCodes' | 'searchScope', value: string) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <FieldLabel>Status Code</FieldLabel>
        <div className="flex gap-2">
          {STATUS_OPTIONS.map(code => (
            <Chip
              key={code}
              label={code}
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
              key={label}
              label={label}
              active={local.contentTypeShow === value}
              onClick={() => patch('contentTypeShow', local.contentTypeShow === value ? '' : value)}
            />
          ))}
        </div>
        <div className="space-y-2">
          <LabeledInput label="Only Show" placeholder="e.g. application/json" value={local.contentTypeShow} onChange={v => patch('contentTypeShow', v)} intent="show" mono />
          <LabeledInput label="Hide"      placeholder="e.g. text/css"         value={local.contentTypeHide} onChange={v => patch('contentTypeHide', v)} intent="hide" mono />
        </div>
      </div>
    </div>
  )
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
      {children}
    </p>
  )
}

function Chip({
  label, active, activeClass, onClick,
}: {
  label: string
  active: boolean
  activeClass?: string
  onClick: () => void
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

function Toggle({
  label, checked, onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full py-2 group"
    >
      <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
        {label}
      </span>
      <div className={cn('w-9 h-5 rounded-full flex-shrink-0 transition-colors relative', checked ? 'bg-primary' : 'bg-muted-foreground/30')}>
        <div className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )} />
      </div>
    </button>
  )
}

function TextInput({
  placeholder, value, onChange, mono,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
}) {
  return (
    <div className="relative">
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'w-full px-3 py-2 text-sm bg-background border border-border rounded-md',
          'focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground',
          mono && 'font-mono',
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

function LabeledInput({
  label, placeholder, value, onChange, intent, mono,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  intent: 'show' | 'hide'
  mono?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn(
        'text-xs font-medium w-16 text-right flex-shrink-0',
        intent === 'show' ? 'text-green-400' : 'text-red-400',
      )}>
        {label}
      </span>
      <div className="relative flex-1">
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className={cn(
            'w-full px-3 py-1.5 text-sm bg-background border rounded-md',
            'focus:outline-none focus:ring-1 placeholder:text-muted-foreground',
            mono && 'font-mono',
            intent === 'show'
              ? 'border-green-500/30 focus:ring-green-500/40 focus:border-green-500/50'
              : 'border-red-500/30 focus:ring-red-500/40 focus:border-red-500/50',
          )}
        />
        {value && (
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
