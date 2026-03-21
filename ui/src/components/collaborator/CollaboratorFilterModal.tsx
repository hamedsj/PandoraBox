import { useState, useEffect, useRef } from 'react'
import { X, Filter, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'search' | 'protocol'

export interface CollaboratorFilters {
  search: string
  caseInsensitive: boolean
  negativeSearch: boolean
  protocols: string[]     // empty = all
  dnsTypes: string[]      // empty = all DNS types
  errorsOnly: boolean
}

export const defaultCollaboratorFilters: CollaboratorFilters = {
  search: '',
  caseInsensitive: true,
  negativeSearch: false,
  protocols: [],
  dnsTypes: [],
  errorsOnly: false,
}

const PROTOCOL_OPTIONS = [
  { value: 'dns',  label: 'DNS',  color: 'bg-violet-500/20 border-violet-500/50 text-violet-400' },
  { value: 'http', label: 'HTTP', color: 'bg-blue-500/20 border-blue-500/50 text-blue-400' },
  { value: 'smtp', label: 'SMTP / MX', color: 'bg-orange-500/20 border-orange-500/50 text-orange-400' },
  { value: 'ldap', label: 'LDAP', color: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' },
] as const

const DNS_TYPE_OPTIONS = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'PTR', 'CNAME', 'SOA'] as const

function countForTab(tab: Tab, f: CollaboratorFilters): number {
  if (tab === 'search') {
    return [f.search, !f.caseInsensitive, f.negativeSearch, f.errorsOnly].filter(Boolean).length
  }
  return [f.protocols.length > 0, f.dnsTypes.length > 0].filter(Boolean).length
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean
  onClose: () => void
  filters: CollaboratorFilters
  onApply: (f: CollaboratorFilters) => void
}

export function CollaboratorFilterModal({ isOpen, onClose, filters, onApply }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<Tab>('search')
  const [local, setLocal] = useState<CollaboratorFilters>(filters)

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

  function patch<K extends keyof CollaboratorFilters>(key: K, value: CollaboratorFilters[K]) {
    setLocal(prev => ({ ...prev, [key]: value }))
  }

  function toggleProtocol(value: string) {
    setLocal(prev => {
      const protocols = prev.protocols.includes(value)
        ? prev.protocols.filter(p => p !== value)
        : [...prev.protocols, value]
      return { ...prev, protocols }
    })
  }

  function toggleDnsType(value: string) {
    setLocal(prev => {
      const dnsTypes = prev.dnsTypes.includes(value)
        ? prev.dnsTypes.filter(t => t !== value)
        : [...prev.dnsTypes, value]
      return { ...prev, dnsTypes }
    })
  }

  const handleApply = () => { onApply(local); onClose() }
  const handleReset = () => setLocal(defaultCollaboratorFilters)
  const handleBackdrop = (e: React.MouseEvent) => { if (e.target === backdropRef.current) onClose() }

  const totalActive = (['search', 'protocol'] as Tab[]).reduce(
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
            <span className="text-sm font-semibold">Filter Interactions</span>
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

        {/* Tabs */}
        <div className="flex border-b border-border px-1">
          {(['search', 'protocol'] as Tab[]).map(tab => {
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

        {/* Content */}
        <div className="h-64 p-5 overflow-y-auto">
          {activeTab === 'search' && (
            <div className="flex flex-col gap-5">
              <div>
                <FieldLabel>Search</FieldLabel>
                <TextInput
                  placeholder="Search in IP address or raw request..."
                  value={local.search}
                  onChange={v => patch('search', v)}
                />
                <p className="text-xs text-muted-foreground mt-1.5">Matches against remote IP and raw request/response content</p>
              </div>
              <div>
                <FieldLabel>Options</FieldLabel>
                <div className="divide-y divide-border/40">
                  <Toggle label="Case Sensitive"  checked={!local.caseInsensitive} onChange={v => patch('caseInsensitive', !v)} />
                  <Toggle label="Invert Results"  checked={local.negativeSearch}   onChange={v => patch('negativeSearch', v)} />
                  <Toggle label="Errors Only"     checked={local.errorsOnly}       onChange={v => patch('errorsOnly', v)} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'protocol' && (
            <div className="flex flex-col gap-5">
              <div>
                <FieldLabel>Protocol <span className="font-normal normal-case tracking-normal text-muted-foreground">— none = all</span></FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {PROTOCOL_OPTIONS.map(({ value, label, color }) => (
                    <button
                      key={value}
                      onClick={() => toggleProtocol(value)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors',
                        local.protocols.includes(value)
                          ? color
                          : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground',
                      )}
                    >
                      {local.protocols.includes(value) && <Check size={10} strokeWidth={3} />}
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>DNS Query Type <span className="font-normal normal-case tracking-normal text-muted-foreground">— none = all</span></FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {DNS_TYPE_OPTIONS.map(type => (
                    <button
                      key={type}
                      onClick={() => toggleDnsType(type)}
                      className={cn(
                        'px-2.5 py-1 rounded-md border text-xs font-mono font-medium transition-colors',
                        local.dnsTypes.includes(type)
                          ? 'bg-violet-500/20 border-violet-500/50 text-violet-400'
                          : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground',
                      )}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">DNS type filter only applies when DNS protocol is selected or no protocol filter is set</p>
              </div>
            </div>
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

// ─── Primitives ───────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{children}</p>
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

function TextInput({ placeholder, value, onChange }: {
  placeholder: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div className="relative">
      <input
        type="text" placeholder={placeholder} value={value}
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
