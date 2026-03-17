import { useState, useEffect, useCallback } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Plus, Trash2, Replace, AlertCircle } from 'lucide-react'
import { api, type MatchReplaceRule } from '@/api/client'
import { useProxyStore } from '@/store/proxy'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/Checkbox'
import { Select } from '@/components/ui/Select'
import { MiddlewareTab } from '@/components/middleware/MiddlewareTab'

const TARGETS = [
  { value: 'req-url', label: 'Request URL' },
  { value: 'req-header', label: 'Request Header' },
  { value: 'req-body', label: 'Request Body' },
  { value: 'res-header', label: 'Response Header' },
  { value: 'res-body', label: 'Response Body' },
] as const

let nextId = Date.now()

function emptyRule(): MatchReplaceRule {
  return {
    id: nextId++,
    enabled: true,
    name: '',
    target: 'req-header',
    is_regex: false,
    match: '',
    replace: '',
  }
}

interface RuleRowProps {
  rule: MatchReplaceRule
  onChange: (rule: MatchReplaceRule) => void
  onDelete: () => void
}

function RuleRow({ rule, onChange, onDelete }: RuleRowProps) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/40 border border-border">
      <Checkbox
        checked={rule.enabled}
        onChange={(checked) => onChange({ ...rule, enabled: checked })}
        title="Enable rule"
      />
      <Select
        value={rule.target}
        onChange={(v) => onChange({ ...rule, target: v as MatchReplaceRule['target'] })}
        options={TARGETS.map((t) => ({ value: t.value, label: t.label }))}
        className="w-36 flex-shrink-0"
      />
      <button
        onClick={() => onChange({ ...rule, is_regex: !rule.is_regex })}
        title="Toggle regex"
        className={cn(
          'flex-shrink-0 px-2 py-1 rounded text-xs font-mono border transition-colors',
          rule.is_regex
            ? 'bg-primary/20 text-primary border-primary/40'
            : 'bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
        )}
      >
        .*
      </button>
      <input
        type="text"
        value={rule.match}
        onChange={(e) => onChange({ ...rule, match: e.target.value })}
        placeholder="match…"
        className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-0 font-mono"
      />
      <span className="flex-shrink-0 text-muted-foreground text-sm select-none">→</span>
      <input
        type="text"
        value={rule.replace}
        onChange={(e) => onChange({ ...rule, replace: e.target.value })}
        placeholder="replace with (empty = delete)"
        className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-0 font-mono"
      />
      <input
        type="text"
        value={rule.name ?? ''}
        onChange={(e) => onChange({ ...rule, name: e.target.value })}
        placeholder="note…"
        className="bg-background border border-border rounded px-2 py-1 text-xs text-muted-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary flex-shrink-0 w-28"
      />
      <button
        onClick={onDelete}
        className="flex-shrink-0 p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
        title="Delete rule"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function MatchReplaceRules() {
  const project = useProxyStore((s) => s.project)
  const setProject = useProxyStore((s) => s.setProject)

  const [local, setLocal] = useState<MatchReplaceRule[]>([])
  const [saved, setSaved] = useState<MatchReplaceRule[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((rules: MatchReplaceRule[]) => {
    setLocal(rules)
    setSaved(rules)
  }, [])

  useEffect(() => {
    if (project?.match_replace) {
      load(project.match_replace)
    } else {
      api.project.get().then((p) => load(p.match_replace ?? [])).catch(() => {})
    }
  }, [project?.match_replace, load])

  const isDirty = JSON.stringify(local) !== JSON.stringify(saved)

  const addRule = () => setLocal((prev) => [...prev, emptyRule()])

  const updateRule = (idx: number, rule: MatchReplaceRule) => {
    setLocal((prev) => {
      const next = [...prev]
      next[idx] = rule
      return next
    })
  }

  const deleteRule = (idx: number) => {
    setLocal((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const updated = await api.project.update({ match_replace: local })
      setProject(updated)
      setSaved(local)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    setLocal(saved)
    setError(null)
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-6 max-w-5xl mx-auto w-full gap-6">
      {/* Rules section */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rules</span>
          <button
            onClick={addRule}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            <Plus size={12} />
            Add Rule
          </button>
        </div>

        {local.length === 0 ? (
          <div className="text-xs text-muted-foreground italic px-2 py-6 text-center border border-dashed border-border rounded-lg">
            No rules yet. Add one to start transforming traffic.
          </div>
        ) : (
          <div className="space-y-1.5">
            {local.map((rule, i) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onChange={(r) => updateRule(i, r)}
                onDelete={() => deleteRule(i)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
          <AlertCircle size={13} />
          {error}
        </div>
      )}

      {/* Actions */}
      {isDirty && (
        <div className="flex items-center justify-end gap-2 pb-6">
          <button
            onClick={handleDiscard}
            className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}

export function MatchReplacePage() {
  return (
    <Tabs.Root defaultValue="rules" className="flex flex-col h-full overflow-hidden">
      {/* Page header with tabs */}
      <div className="flex items-center gap-4 px-6 pt-5 pb-0 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Replace size={18} className="text-primary" />
          <h1 className="text-base font-semibold text-foreground">Match &amp; Replace</h1>
        </div>
        <Tabs.List className="flex gap-0.5 ml-4">
          <Tabs.Trigger
            value="rules"
            className={cn(
              'px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
              'data-[state=active]:border-primary data-[state=active]:text-primary',
              'data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground'
            )}
          >
            Rules
          </Tabs.Trigger>
          <Tabs.Trigger
            value="middleware"
            className={cn(
              'px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
              'data-[state=active]:border-primary data-[state=active]:text-primary',
              'data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground'
            )}
          >
            Middleware
          </Tabs.Trigger>
        </Tabs.List>
      </div>

      <Tabs.Content value="rules" className="flex-1 overflow-hidden">
        <MatchReplaceRules />
      </Tabs.Content>

      <Tabs.Content value="middleware" className="flex-1 overflow-hidden">
        <MiddlewareTab />
      </Tabs.Content>
    </Tabs.Root>
  )
}
