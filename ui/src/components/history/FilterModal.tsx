import { useState, useEffect } from 'react'
import { useProxyStore } from '@/store/proxy'
import { cn } from '@/lib/utils'
import { X, FileText, FileJson, Filter, Search, Check, Hash } from 'lucide-react'

export function FilterModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { filters, setFilters, resetFilters } = useProxyStore()

  const [tempPathExtension, setTempPathExtension] = useState(filters.pathExtension)
  const [tempContentType, setTempContentType] = useState(filters.contentType)

  useEffect(() => {
    if (isOpen) {
      setTempPathExtension(filters.pathExtension)
      setTempContentType(filters.contentType)
    }
  }, [isOpen, filters.pathExtension, filters.contentType])

  function handleApply() {
    setFilters({
      pathExtension: tempPathExtension,
      contentType: tempContentType,
    })
    onClose()
  }

  function handleReset() {
    resetFilters()
    setTempPathExtension('')
    setTempContentType('')
  }

  function toggleFilter(key: keyof typeof filters) {
    return () => {
      setFilters({ [key]: !filters[key] as any })
    }
  }

  function toggleScope(scope: 'host' | 'path' | 'query' | 'headers' | 'body') {
    return () => {
      const current = filters.searchScope
      if (current === scope) {
        setFilters({ searchScope: 'all' })
      } else {
        setFilters({ searchScope: scope })
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-primary" />
            <span className="text-sm font-semibold">Advanced Filters</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Left column */}
            <div className="space-y-4">
              {/* File Extension */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <FileText size={14} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-medium">File Extension</span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. json, html"
                    value={tempPathExtension}
                    onChange={(e) => setTempPathExtension(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                  {tempPathExtension && (
                    <button
                      onClick={() => setTempPathExtension('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Content Type */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <FileJson size={14} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-medium">Content-Type</span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. application/json"
                    value={tempContentType}
                    onChange={(e) => setTempContentType(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                  {tempContentType && (
                    <button
                      onClick={() => setTempContentType('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-4">
              {/* Search Options */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Search size={14} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-medium">Search Options</span>
                </div>
                <div className="space-y-2">
                  <ToggleOption
                    label="Negative Search (exclude matches)"
                    checked={filters.negativeSearch}
                    onChange={toggleFilter('negativeSearch')}
                  />
                  <ToggleOption
                    label="Case Insensitive"
                    checked={filters.caseInsensitive}
                    onChange={toggleFilter('caseInsensitive')}
                  />
                  <ToggleOption
                    label="Use Regex"
                    checked={filters.useRegex}
                    onChange={toggleFilter('useRegex')}
                  />
                </div>
              </div>

              {/* Search Scope */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Hash size={14} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-medium">Search Scope</span>
                </div>
                <div className="space-y-1.5">
                  <ScopeCheckbox
                    label="All Fields"
                    checked={filters.searchScope === 'all'}
                    onChange={() => setFilters({ searchScope: 'all' })}
                  />
                  <ScopeCheckbox
                    label="Host"
                    checked={filters.searchScope === 'host'}
                    onChange={toggleScope('host')}
                  />
                  <ScopeCheckbox
                    label="Path"
                    checked={filters.searchScope === 'path'}
                    onChange={toggleScope('path')}
                  />
                  <ScopeCheckbox
                    label="Query"
                    checked={filters.searchScope === 'query'}
                    onChange={toggleScope('query')}
                  />
                  <ScopeCheckbox
                    label="Headers"
                    checked={filters.searchScope === 'headers'}
                    onChange={toggleScope('headers')}
                  />
                  <ScopeCheckbox
                    label="Body"
                    checked={filters.searchScope === 'body'}
                    onChange={toggleScope('body')}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/20">
          <button
            onClick={handleReset}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset All
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-muted hover:bg-muted/70 transition-colors text-xs font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs font-medium"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ScopeCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="flex items-center gap-2 text-xs hover:text-foreground transition-colors text-left w-full"
    >
      <div className={cn(
        'w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors',
        checked ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'
      )}>
        {checked && <Check size={10} />}
      </div>
      {label}
    </button>
  )
}

function ToggleOption({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="flex items-center justify-between text-xs hover:text-foreground transition-colors w-full"
    >
      {label}
      <div className={cn(
        'w-8 h-4 rounded-full transition-colors relative',
        checked ? 'bg-primary' : 'bg-muted-foreground/30'
      )}>
        <div className={cn(
          'absolute top-0.5 w-3 h-3 rounded-full bg-background transition-transform',
          checked ? 'left-4.5' : 'left-0.5'
        )} />
      </div>
    </button>
  )
}
