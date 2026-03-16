import { useState, useEffect, useRef } from 'react'
import { useProxyStore } from '@/store/proxy'
import { cn } from '@/lib/utils'
import { X, Filter } from 'lucide-react'

const SCOPE_OPTIONS = ['host', 'path', 'query', 'headers', 'body'] as const
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

interface LocalFilters {
  host: string
  pathExtension: string
  contentType: string
  statusCodes: string[]
  negativeSearch: boolean
  caseInsensitive: boolean
  useRegex: boolean
  searchScope: string[]
}

function defaultLocal(filters: ReturnType<typeof useProxyStore.getState>['filters']): LocalFilters {
  return {
    host: filters.host,
    pathExtension: filters.pathExtension,
    contentType: filters.contentType,
    statusCodes: filters.statusCodes,
    negativeSearch: filters.negativeSearch,
    caseInsensitive: filters.caseInsensitive,
    useRegex: filters.useRegex,
    searchScope: filters.searchScope,
  }
}

function emptyLocal(): LocalFilters {
  return {
    host: '',
    pathExtension: '',
    contentType: '',
    statusCodes: [],
    negativeSearch: false,
    caseInsensitive: true,
    useRegex: false,
    searchScope: [],
  }
}

export function FilterModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { filters, setFilters, resetFilters } = useProxyStore()
  const backdropRef = useRef<HTMLDivElement>(null)
  const [local, setLocal] = useState<LocalFilters>(() => defaultLocal(filters))

  // Sync from store when modal opens
  useEffect(() => {
    if (isOpen) setLocal(defaultLocal(filters))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Keep a ref so keyboard handler always sees fresh local state
  const localRef = useRef(local)
  useEffect(() => { localRef.current = local }, [local])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        setFilters(localRef.current)
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose, setFilters])

  function patch<K extends keyof LocalFilters>(key: K, value: LocalFilters[K]) {
    setLocal(prev => ({ ...prev, [key]: value }))
  }

  function toggle<K extends keyof LocalFilters>(key: K) {
    setLocal(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function toggleArrayItem(key: 'statusCodes' | 'searchScope', value: string) {
    setLocal(prev => {
      const arr = prev[key]
      return {
        ...prev,
        [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value],
      }
    })
  }

  function handleApply() {
    setFilters(local)
    onClose()
  }

  function handleReset() {
    resetFilters()
    setLocal(emptyLocal())
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose()
  }

  const activeCount = [
    local.host,
    local.pathExtension,
    local.contentType,
    local.statusCodes.length > 0,
    local.negativeSearch,
    !local.caseInsensitive,
    local.useRegex,
    local.searchScope.length > 0,
  ].filter(Boolean).length

  if (!isOpen) return null

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-primary" />
            <span className="text-sm font-semibold">Advanced Filters</span>
            {activeCount > 0 && (
              <span className="bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full font-medium">
                {activeCount} active
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 min-h-0">

          {/* Search Scope */}
          <Section title="Search Scope" hint="Where the search bar looks — none selected = all fields">
            <div className="flex flex-wrap gap-1.5">
              {SCOPE_OPTIONS.map(scope => (
                <Chip
                  key={scope}
                  label={scope.charAt(0).toUpperCase() + scope.slice(1)}
                  active={local.searchScope.includes(scope)}
                  onClick={() => toggleArrayItem('searchScope', scope)}
                />
              ))}
            </div>
          </Section>

          {/* Search Options */}
          <Section title="Search Options">
            <div className="space-y-3">
              <Toggle
                label="Case Sensitive"
                description="Match exact case (off = ignore case)"
                checked={!local.caseInsensitive}
                onChange={v => patch('caseInsensitive', !v)}
              />
              <Toggle
                label="Regular Expression"
                description="Treat search term as a regex pattern"
                checked={local.useRegex}
                onChange={v => patch('useRegex', v)}
              />
              <Toggle
                label="Invert Results"
                description="Show requests that do NOT match"
                checked={local.negativeSearch}
                onChange={() => toggle('negativeSearch')}
              />
            </div>
          </Section>

          {/* Status Code */}
          <Section title="Response Status" hint="Show only matching ranges">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map(code => (
                <Chip
                  key={code}
                  label={code}
                  active={local.statusCodes.includes(code)}
                  activeClass={statusActiveClass(code)}
                  onClick={() => toggleArrayItem('statusCodes', code)}
                />
              ))}
            </div>
          </Section>

          {/* Host */}
          <Section title="Host">
            <TextInput
              placeholder="e.g. api.example.com"
              value={local.host}
              onChange={v => patch('host', v)}
            />
          </Section>

          {/* Content Type */}
          <Section title="Response Content-Type">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {CONTENT_TYPE_CHIPS.map(({ label, value }) => (
                <Chip
                  key={label}
                  label={label}
                  active={local.contentType === value}
                  onClick={() => patch('contentType', local.contentType === value ? '' : value)}
                />
              ))}
            </div>
            <TextInput
              placeholder="Custom content-type..."
              value={local.contentType}
              onChange={v => patch('contentType', v)}
              mono
            />
          </Section>

          {/* File Extension */}
          <Section title="File Extension" hint="Matches the path suffix">
            <TextInput
              placeholder="e.g. js, php, json (no dot needed)"
              value={local.pathExtension}
              onChange={v => patch('pathExtension', v)}
              mono
            />
          </Section>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/20 flex-shrink-0">
          <button
            onClick={handleReset}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset All
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-xs text-muted-foreground select-none">
              ⌘↵ to apply
            </span>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md bg-muted hover:bg-muted/70 transition-colors text-xs font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs font-medium"
            >
              Apply
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Chip({
  label,
  active,
  activeClass,
  onClick,
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
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full gap-3 group"
    >
      <div className="text-left">
        <div className="text-sm group-hover:text-foreground transition-colors">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {/* Toggle pill */}
      <div className={cn('w-9 h-5 rounded-full flex-shrink-0 transition-colors relative', checked ? 'bg-primary' : 'bg-muted-foreground/30')}>
        <div
          className={cn(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </div>
    </button>
  )
}

function TextInput({
  placeholder,
  value,
  onChange,
  mono,
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
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

function statusActiveClass(code: string): string {
  switch (code[0]) {
    case '1': return 'bg-blue-500/20 border-blue-500/50 text-blue-400'
    case '2': return 'bg-green-500/20 border-green-500/50 text-green-400'
    case '3': return 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400'
    case '4': return 'bg-orange-500/20 border-orange-500/50 text-orange-400'
    case '5': return 'bg-red-500/20 border-red-500/50 text-red-400'
    default:  return ''
  }
}
