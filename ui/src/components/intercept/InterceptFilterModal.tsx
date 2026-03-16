import { useState, useEffect, useRef } from 'react'
import type { InterceptFilter } from '@/api/client'
import { cn } from '@/lib/utils'
import { X, Filter } from 'lucide-react'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const

export function InterceptFilterModal({
  isOpen,
  onClose,
  filter,
  onApply,
}: {
  isOpen: boolean
  onClose: () => void
  filter: InterceptFilter
  onApply: (f: InterceptFilter) => void
}) {
  const [local, setLocal] = useState<InterceptFilter>(filter)
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) setLocal(filter)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onApply(local)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, local, onApply, onClose])

  if (!isOpen) return null

  const isActive = !!(local.host || local.method || local.path)

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={handleBackdrop}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-primary" />
            <span className="text-sm font-semibold">Intercept Filter</span>
            {isActive && (
              <span className="bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full font-medium">
                active
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
        <div className="p-5 space-y-5">
          <p className="text-xs text-muted-foreground">
            Only hold requests matching <span className="font-medium text-foreground">all</span> specified conditions.
            Leave a field empty to match any value.
          </p>

          {/* Method */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 block">
              Method
            </label>
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map((m) => (
                <button
                  key={m}
                  onClick={() => setLocal((l) => ({ ...l, method: l.method === m ? '' : m }))}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                    local.method === m
                      ? 'bg-primary/20 border-primary text-primary'
                      : 'bg-transparent border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Host */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
              Host <span className="font-normal normal-case tracking-normal text-muted-foreground">— substring</span>
            </label>
            <FieldInput
              placeholder="e.g. api.example.com"
              value={local.host}
              onChange={(v) => setLocal((l) => ({ ...l, host: v }))}
            />
          </div>

          {/* Path */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
              Path <span className="font-normal normal-case tracking-normal text-muted-foreground">— substring</span>
            </label>
            <FieldInput
              placeholder="e.g. /api/v2/"
              value={local.path}
              onChange={(v) => setLocal((l) => ({ ...l, path: v }))}
              mono
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/20 rounded-b-xl">
          <button
            onClick={() => setLocal({ host: '', method: '', path: '' })}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear All
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-xs text-muted-foreground select-none">⌘↵ to apply</span>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md bg-muted hover:bg-muted/70 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(local)}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors"
            >
              Apply
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

function FieldInput({
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
        onChange={(e) => onChange(e.target.value)}
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
