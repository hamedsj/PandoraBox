import { useState } from 'react'
import { Trash2, ChevronDown, ChevronUp, Globe } from 'lucide-react'
import { CodeViewer } from '@/components/common/CodeViewer'
import type { FlowStep } from '@/api/client'
import type { StepResult } from '@/lib/flowExecution'
import { cn } from '@/lib/utils'

interface FlowRequestCardProps {
  step: FlowStep
  index: number
  stepResult?: StepResult
  onChange: (step: FlowStep) => void
  onDelete: () => void
}

export function FlowRequestCard({ step, index, stepResult, onChange, onDelete }: FlowRequestCardProps) {
  const [expanded, setExpanded] = useState(true)

  const rawDecoded = (() => {
    try { return atob(step.raw ?? '') } catch { return '' }
  })()

  function handleRawChange(val: string) {
    onChange({ ...step, raw: btoa(val) })
  }

  const statusColor =
    stepResult?.status === 'done' ? 'border-emerald-500/40 bg-emerald-500/5' :
    stepResult?.status === 'error' ? 'border-red-500/40 bg-red-500/5' :
    stepResult?.status === 'running' ? 'border-primary/40 bg-primary/5' :
    'border-border bg-card'

  return (
    <div className={cn('rounded-lg border transition-colors', statusColor)}>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Globe size={14} className="text-muted-foreground flex-shrink-0" />
          <span className="text-xs font-medium text-muted-foreground flex-shrink-0">#{index + 1}</span>
          <input
            type="text"
            value={step.name ?? ''}
            onChange={(e) => onChange({ ...step, name: e.target.value })}
            placeholder="Request step name"
            className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {stepResult?.status === 'done' && (
            <span className="text-[10px] font-medium text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/20">done</span>
          )}
          {stepResult?.status === 'error' && (
            <span className="text-[10px] font-medium text-red-400 px-1.5 py-0.5 rounded bg-red-500/20" title={stepResult.error}>error</span>
          )}
          {stepResult?.status === 'running' && (
            <span className="text-[10px] font-medium text-primary px-1.5 py-0.5 rounded bg-primary/20">running</span>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            onClick={onDelete}
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-red-400"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <p className="text-[11px] text-muted-foreground mb-2">
            Raw HTTP — use <code className="font-mono bg-muted px-1 rounded">{`{{variable}}`}</code> for interpolation
          </p>
          <CodeViewer
            value={rawDecoded}
            language="http"
            readOnly={false}
            onChange={handleRawChange}
            minHeight={120}
            maxHeight={300}
            autoHeight={false}
          />
          {stepResult?.response && (
            <div className="mt-2 text-xs text-muted-foreground">
              Response: <span className="text-foreground font-mono">
                {stepResult.response.response?.status_code ?? '?'}
              </span>
              {' · '}
              <span className="font-mono">
                {stepResult.response.response?.size_bytes ?? 0}B
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
