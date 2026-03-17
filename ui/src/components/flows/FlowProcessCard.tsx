import { useState } from 'react'
import { Trash2, ChevronDown, ChevronUp, Code2 } from 'lucide-react'
import { CodeViewer } from '@/components/common/CodeViewer'
import type { FlowStep } from '@/api/client'
import type { StepResult } from '@/lib/flowExecution'
import { cn } from '@/lib/utils'

const DEFAULT_CODE = `def process(ctx):
    # ctx.response.status  - int
    # ctx.response.headers - dict
    # ctx.response.body    - str
    # ctx.variables        - dict of current variables
    #
    # Return a dict with "variables" key to update variables:
    # return {"variables": {"token": "extracted_value"}}
    return {}
`

interface FlowProcessCardProps {
  step: FlowStep
  index: number
  stepResult?: StepResult
  onChange: (step: FlowStep) => void
  onDelete: () => void
}

export function FlowProcessCard({ step, index, stepResult, onChange, onDelete }: FlowProcessCardProps) {
  const [expanded, setExpanded] = useState(true)

  const code = step.code ?? DEFAULT_CODE

  const statusColor =
    stepResult?.status === 'done' ? 'border-emerald-500/40 bg-emerald-500/5' :
    stepResult?.status === 'error' ? 'border-red-500/40 bg-red-500/5' :
    stepResult?.status === 'running' ? 'border-primary/40 bg-primary/5' :
    'border-border bg-card'

  return (
    <div className={cn('rounded-lg border transition-colors', statusColor)}>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Code2 size={14} className="text-purple-400 flex-shrink-0" />
          <span className="text-xs font-medium text-muted-foreground flex-shrink-0">#{index + 1}</span>
          <input
            type="text"
            value={step.name ?? ''}
            onChange={(e) => onChange({ ...step, name: e.target.value })}
            placeholder="Process step name"
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
          {stepResult?.extractedVars && Object.keys(stepResult.extractedVars).length > 0 && (
            <span className="text-[10px] font-medium text-purple-400 px-1.5 py-0.5 rounded bg-purple-500/20">
              +{Object.keys(stepResult.extractedVars).length} vars
            </span>
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
            Python — define <code className="font-mono bg-muted px-1 rounded">process(ctx)</code> and return{' '}
            <code className="font-mono bg-muted px-1 rounded">{'{"variables": {...}}'}</code>
          </p>
          <CodeViewer
            value={code}
            language="python"
            readOnly={false}
            onChange={(val) => onChange({ ...step, code: val })}
            minHeight={140}
            maxHeight={320}
            autoHeight={false}
          />
        </div>
      )}
    </div>
  )
}
