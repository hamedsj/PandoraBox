import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Target, AlertCircle } from 'lucide-react'
import { api, type ScopeConfig, type ScopeRule } from '@/api/client'
import { useProxyStore } from '@/store/proxy'
import { cn } from '@/lib/utils'

const PATTERN_TYPES = [
  { value: 'contains', label: 'Contains' },
  { value: 'wildcard', label: 'Wildcard' },
  { value: 'regex', label: 'Regex' },
  { value: 'exact', label: 'Exact' },
] as const

function emptyRule(): ScopeRule {
  return { enabled: true, pattern_type: 'contains', host: '', path: '' }
}

function emptyScope(): ScopeConfig {
  return { enabled: false, include_rules: [], exclude_rules: [] }
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

interface RuleRowProps {
  rule: ScopeRule
  onChange: (rule: ScopeRule) => void
  onDelete: () => void
}

function RuleRow({ rule, onChange, onDelete }: RuleRowProps) {
  const isRegex = rule.pattern_type === 'regex'
  const hostInvalid = isRegex && rule.host !== '' && !isValidRegex(rule.host)
  const pathInvalid = isRegex && rule.path !== '' && !isValidRegex(rule.path)

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/40 border border-border">
      <input
        type="checkbox"
        checked={rule.enabled}
        onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
        className="w-4 h-4 accent-primary flex-shrink-0 cursor-pointer"
      />
      <select
        value={rule.pattern_type}
        onChange={(e) => onChange({ ...rule, pattern_type: e.target.value as ScopeRule['pattern_type'] })}
        className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary flex-shrink-0 w-24"
      >
        {PATTERN_TYPES.map((pt) => (
          <option key={pt.value} value={pt.value}>{pt.label}</option>
        ))}
      </select>
      <input
        type="text"
        value={rule.host}
        onChange={(e) => onChange({ ...rule, host: e.target.value })}
        placeholder="host (e.g. *.example.com)"
        className={cn(
          'flex-1 bg-background border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-0',
          isRegex ? 'font-mono' : '',
          hostInvalid ? 'border-red-500 focus:ring-red-500' : 'border-border'
        )}
      />
      <input
        type="text"
        value={rule.path}
        onChange={(e) => onChange({ ...rule, path: e.target.value })}
        placeholder="path (any)"
        className={cn(
          'flex-1 bg-background border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-0',
          isRegex ? 'font-mono' : '',
          pathInvalid ? 'border-red-500 focus:ring-red-500' : 'border-border'
        )}
      />
      <button
        onClick={onDelete}
        className="flex-shrink-0 p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
        title="Remove rule"
      >
        <X size={14} />
      </button>
    </div>
  )
}

interface RuleListProps {
  label: string
  rules: ScopeRule[]
  onChange: (rules: ScopeRule[]) => void
}

function RuleList({ label, rules, onChange }: RuleListProps) {
  const addRule = () => onChange([...rules, emptyRule()])
  const updateRule = (i: number, rule: ScopeRule) => {
    const next = [...rules]
    next[i] = rule
    onChange(next)
  }
  const deleteRule = (i: number) => onChange(rules.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <button
          onClick={addRule}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          <Plus size={12} />
          Add
        </button>
      </div>
      {rules.length === 0 ? (
        <div className="text-xs text-muted-foreground italic px-2 py-3 text-center border border-dashed border-border rounded-lg">
          No rules — click Add to create one
        </div>
      ) : (
        <div className="space-y-1.5">
          {rules.map((rule, i) => (
            <RuleRow
              key={i}
              rule={rule}
              onChange={(r) => updateRule(i, r)}
              onDelete={() => deleteRule(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function ScopePage() {
  const project = useProxyStore((s) => s.project)
  const setProject = useProxyStore((s) => s.setProject)

  const [local, setLocal] = useState<ScopeConfig>(emptyScope())
  const [saved, setSaved] = useState<ScopeConfig>(emptyScope())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((scope: ScopeConfig) => {
    setLocal(scope)
    setSaved(scope)
  }, [])

  useEffect(() => {
    if (project?.scope) {
      load(project.scope)
    } else {
      api.project.get().then((p) => load(p.scope)).catch(() => {})
    }
  }, [project?.scope, load])

  const isDirty = JSON.stringify(local) !== JSON.stringify(saved)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const updated = await api.project.update({ scope: local })
      setProject(updated)
      setSaved(updated.scope)
      setLocal(updated.scope)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setLocal(saved)
    setError(null)
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-6 max-w-3xl mx-auto w-full gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Target size={20} className="text-primary" />
        <h1 className="text-lg font-semibold text-foreground">Scope Rules</h1>
        {isDirty && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500 font-medium">
            Unsaved changes
          </span>
        )}
      </div>

      {/* Enable toggle */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div className="relative">
            <input
              type="checkbox"
              checked={local.enabled}
              onChange={(e) => setLocal({ ...local, enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className={cn(
              'w-10 h-5 rounded-full transition-colors',
              local.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
            )}>
              <div className={cn(
                'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                local.enabled ? 'translate-x-5' : 'translate-x-0'
              )} />
            </div>
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">Enable Scope</div>
            <div className="text-xs text-muted-foreground">
              When enabled, only in-scope traffic is captured and stored.
            </div>
          </div>
        </label>
        {!local.enabled && (
          <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground">
            <AlertCircle size={13} />
            Scope is inactive — all traffic is being captured.
          </div>
        )}
      </div>

      {/* Include rules */}
      <div className="rounded-xl border border-border bg-card p-4">
        <RuleList
          label="Include Rules"
          rules={local.include_rules}
          onChange={(rules) => setLocal({ ...local, include_rules: rules })}
        />
      </div>

      {/* Exclude rules */}
      <div className="rounded-xl border border-border bg-card p-4">
        <RuleList
          label="Exclude Rules"
          rules={local.exclude_rules}
          onChange={(rules) => setLocal({ ...local, exclude_rules: rules })}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
          <AlertCircle size={13} />
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pb-6">
        <button
          onClick={handleReset}
          disabled={!isDirty}
          className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset
        </button>
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
