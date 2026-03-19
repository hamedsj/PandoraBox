import { useEffect, useRef, useState } from 'react'
import { Plus, Play, Square, Trash2, GitBranch, Globe, Code2, Variable } from 'lucide-react'
import { useFlowsStore } from '@/store/flows'
import { useProxyStore } from '@/store/proxy'
import { api } from '@/api/client'
import type { Flow, FlowStep } from '@/api/client'
import { FlowRequestCard } from '@/components/flows/FlowRequestCard'
import { FlowProcessCard } from '@/components/flows/FlowProcessCard'
import { executeFlow, type FlowRunState } from '@/lib/flowExecution'
import { cn } from '@/lib/utils'

function emptyFlow(): Flow {
  return {
    id: `flow_${Date.now()}`,
    name: 'New Flow',
    steps: [],
    variables: {},
  }
}

export function FlowsPage() {
  const { flows, upsertFlow, deleteFlow, setFlows, runStates, setRunState } = useFlowsStore()
  const setProject = useProxyStore((s) => s.setProject)
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(flows[0]?.id ?? null)
  const [saving, setSaving] = useState(false)
  const [varInput, setVarInput] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const selectedFlow = flows.find((f) => f.id === selectedFlowId) ?? null
  const runState: FlowRunState | undefined = selectedFlowId ? runStates[selectedFlowId] : undefined
  const isRunning = runState?.status === 'running'

  useEffect(() => {
    if (selectedFlowId && flows.some((flow) => flow.id === selectedFlowId)) return
    setSelectedFlowId(flows[0]?.id ?? null)
  }, [flows, selectedFlowId])

  async function saveFlows(updatedFlows: Flow[]) {
    setSaving(true)
    try {
      const updated = await api.project.update({ flows: updatedFlows })
      setProject(updated)
      setFlows(updated.flows)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateFlow() {
    const flow = emptyFlow()
    const updatedFlows = [...flows, flow]
    await saveFlows(updatedFlows)
    setSelectedFlowId(flow.id)
  }

  async function handleDeleteFlow(id: string) {
    if (!confirm('Delete this flow?')) return
    const updatedFlows = flows.filter((f) => f.id !== id)
    deleteFlow(id)
    await saveFlows(updatedFlows)
    if (selectedFlowId === id) {
      setSelectedFlowId(updatedFlows[0]?.id ?? null)
    }
  }

  async function handleFlowChange(updatedFlow: Flow) {
    upsertFlow(updatedFlow)
    const updatedFlows = flows.map((f) => (f.id === updatedFlow.id ? updatedFlow : f))
    await saveFlows(updatedFlows)
  }

  function handleStepChange(stepId: string, updated: FlowStep) {
    if (!selectedFlow) return
    const updatedFlow = {
      ...selectedFlow,
      steps: selectedFlow.steps.map((s) => (s.id === stepId ? updated : s)),
    }
    handleFlowChange(updatedFlow)
  }

  function handleStepDelete(stepId: string) {
    if (!selectedFlow) return
    const updatedFlow = {
      ...selectedFlow,
      steps: selectedFlow.steps.filter((s) => s.id !== stepId),
    }
    handleFlowChange(updatedFlow)
  }

  function addStep(type: 'request' | 'process') {
    if (!selectedFlow) return
    const newStep: FlowStep = {
      id: `step_${Date.now()}`,
      type,
      name: type === 'request' ? 'New Request' : 'New Process',
      raw: type === 'request' ? btoa('GET / HTTP/1.1\r\nHost: example.com\r\n\r\n') : undefined,
      code: type === 'process' ? `def process(ctx):\n    return {}\n` : undefined,
    }
    const updatedFlow = {
      ...selectedFlow,
      steps: [...selectedFlow.steps, newStep],
    }
    handleFlowChange(updatedFlow)
  }

  async function runFlow() {
    if (!selectedFlow || isRunning) return

    const seedVars: Record<string, string> = {}
    if (varInput.trim()) {
      for (const line of varInput.split('\n')) {
        const eq = line.indexOf('=')
        if (eq > 0) {
          seedVars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
        }
      }
    }

    const ctrl = new AbortController()
    abortRef.current = ctrl

    const initial: FlowRunState = {
      stepResults: Object.fromEntries(selectedFlow.steps.map((s) => [s.id, { status: 'pending' as const }])),
      variables: {},
      status: 'running',
      currentStepId: null,
    }
    setRunState(selectedFlow.id, initial)

    try {
      await executeFlow(
        selectedFlow,
        seedVars,
        (state) => setRunState(selectedFlow.id, state),
        ctrl.signal
      )
    } catch {
      // errors are captured in runState
    }
  }

  function stopFlow() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  function addVariable() {
    if (!selectedFlow) return
    const key = prompt('Variable name:')
    if (!key?.trim()) return
    const value = prompt(`Value for ${key}:`) ?? ''
    const updatedFlow: Flow = {
      ...selectedFlow,
      variables: { ...(selectedFlow.variables ?? {}), [key.trim()]: value },
    }
    handleFlowChange(updatedFlow)
  }

  function removeVariable(key: string) {
    if (!selectedFlow) return
    const vars = { ...(selectedFlow.variables ?? {}) }
    delete vars[key]
    handleFlowChange({ ...selectedFlow, variables: vars })
  }

  return (
    <div className="h-full flex">
      {/* Left panel: flow list */}
      <div className="w-56 flex-shrink-0 flex flex-col border-r border-border bg-card">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Flows</span>
          <button
            onClick={handleCreateFlow}
            disabled={saving}
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="New flow"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {flows.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-4 text-center">No flows yet</p>
          )}
          {flows.map((flow) => {
            const state = runStates[flow.id]
            return (
              <button
                key={flow.id}
                onClick={() => setSelectedFlowId(flow.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                  selectedFlowId === flow.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                <GitBranch size={14} className="flex-shrink-0" />
                <span className="flex-1 min-w-0 truncate">{flow.name}</span>
                {state?.status === 'running' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />
                )}
                {state?.status === 'done' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                )}
                {state?.status === 'error' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Right panel: flow editor */}
      {selectedFlow ? (
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card flex-shrink-0">
            <input
              type="text"
              value={selectedFlow.name}
              onChange={(e) => handleFlowChange({ ...selectedFlow, name: e.target.value })}
              className="flex-1 min-w-0 bg-transparent text-sm font-medium outline-none"
            />
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
              {isRunning ? (
                <button
                  onClick={stopFlow}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-500/30 transition-colors"
                >
                  <Square size={12} />
                  Stop
                </button>
              ) : (
                <button
                  onClick={runFlow}
                  disabled={selectedFlow.steps.length === 0}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 text-primary border border-primary/30 rounded-lg text-xs font-medium transition-colors',
                    'hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  <Play size={12} />
                  Run
                </button>
              )}
              <button
                onClick={() => handleDeleteFlow(selectedFlow.id)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-red-400"
                title="Delete flow"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Steps */}
            <div className="space-y-2">
              {selectedFlow.steps.map((step, i) => (
                step.type === 'request' ? (
                  <FlowRequestCard
                    key={step.id}
                    step={step}
                    index={i}
                    stepResult={runState?.stepResults[step.id]}
                    onChange={(updated) => handleStepChange(step.id, updated)}
                    onDelete={() => handleStepDelete(step.id)}
                  />
                ) : (
                  <FlowProcessCard
                    key={step.id}
                    step={step}
                    index={i}
                    stepResult={runState?.stepResults[step.id]}
                    onChange={(updated) => handleStepChange(step.id, updated)}
                    onDelete={() => handleStepDelete(step.id)}
                  />
                )
              ))}
            </div>

            {/* Add step buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => addStep('request')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              >
                <Globe size={12} />
                Add Request
              </button>
              <button
                onClick={() => addStep('process')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-purple-400/40 transition-colors"
              >
                <Code2 size={12} />
                Add Process
              </button>
            </div>

            {/* Variables section */}
            <div className="border border-border rounded-lg">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Variable size={12} />
                  Variables
                </span>
                <button
                  onClick={addVariable}
                  className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  title="Add variable"
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="p-3 space-y-1.5">
                {Object.entries(selectedFlow.variables ?? {}).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No variables. Use <code className="font-mono bg-muted px-1 rounded">{`{{name}}`}</code> in requests.
                  </p>
                )}
                {Object.entries(selectedFlow.variables ?? {}).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">{key}</span>
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => {
                        handleFlowChange({
                          ...selectedFlow,
                          variables: { ...(selectedFlow.variables ?? {}), [key]: e.target.value },
                        })
                      }}
                      className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-0.5 text-xs font-mono outline-none focus:border-primary/60"
                    />
                    <button
                      onClick={() => removeVariable(key)}
                      className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-red-400 flex-shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}

                {/* Runtime extracted variables */}
                {runState && runState.status !== 'idle' && Object.keys(runState.variables).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Runtime values</p>
                    {Object.entries(runState.variables).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-purple-400">{k}</span>
                        <span className="text-muted-foreground">=</span>
                        <span className="text-foreground truncate">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Seed variables input */}
            <div className="border border-border rounded-lg">
              <div className="px-3 py-2 border-b border-border">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Seed Variables (run-time overrides)</span>
              </div>
              <div className="p-3">
                <textarea
                  value={varInput}
                  onChange={(e) => setVarInput(e.target.value)}
                  placeholder={'key=value\ntoken=abc123'}
                  rows={3}
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-primary/60 resize-none placeholder:text-muted-foreground/40"
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
          <GitBranch size={40} className="opacity-20" />
          <p className="text-sm">No flow selected</p>
          <button
            onClick={handleCreateFlow}
            className="flex items-center gap-2 px-4 py-2 bg-primary/20 text-primary border border-primary/30 rounded-lg text-sm font-medium hover:bg-primary/30 transition-colors"
          >
            <Plus size={14} />
            Create a Flow
          </button>
        </div>
      )}
    </div>
  )
}
