import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { ConvertStack, ConverterAlgorithm, ConverterConfig } from '@/api/client'
import { useProxyStore } from '@/store/proxy'
import { useConverterStore } from '@/store/converter'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { Copy, Play, Plus, Trash2, ArrowUp, ArrowDown, RefreshCcw } from 'lucide-react'
import { copyText } from '@/lib/clipboard'

type ConverterTab = 'quick' | 'stack'

const emptyConfig: ConverterConfig = { stacks: [] }

export function ConverterPanel() {
  const project = useProxyStore((s) => s.project)
  const syncProject = useProxyStore((s) => s.syncProject)
  const input = useConverterStore((s) => s.input)
  const output = useConverterStore((s) => s.output)
  const pendingAlgorithm = useConverterStore((s) => s.pendingAlgorithm)
  const setInput = useConverterStore((s) => s.setInput)
  const setOutput = useConverterStore((s) => s.setOutput)
  const clearPendingAlgorithm = useConverterStore((s) => s.clearPendingAlgorithm)

  const [algorithms, setAlgorithms] = useState<ConverterAlgorithm[]>([])
  const [activeTab, setActiveTab] = useState<ConverterTab>('quick')
  const [quickAlgorithm, setQuickAlgorithm] = useState('base64_decode')
  const [config, setConfig] = useState<ConverterConfig>(emptyConfig)
  const [selectedStackId, setSelectedStackId] = useState<string>('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.converter.get().then((r) => setAlgorithms(r.algorithms ?? [])).catch(console.error)
  }, [])

  useEffect(() => {
    if (!pendingAlgorithm || algorithms.length === 0) return
    if (!algorithms.some((a) => a.id === pendingAlgorithm)) return
    setQuickAlgorithm(pendingAlgorithm)
    setActiveTab('quick')
    clearPendingAlgorithm()
  }, [pendingAlgorithm, algorithms, clearPendingAlgorithm])

  useEffect(() => {
    setConfig(normalizeConverterConfig(project?.converter))
  }, [project?.converter])

  useEffect(() => {
    if (!selectedStackId && config.stacks.length > 0) {
      setSelectedStackId(config.stacks[0].id)
    } else if (selectedStackId && !config.stacks.some((s) => s.id === selectedStackId)) {
      setSelectedStackId(config.stacks[0]?.id ?? '')
    }
  }, [config.stacks, selectedStackId])

  const selectedStack = useMemo(
    () => config.stacks.find((s) => s.id === selectedStackId) ?? null,
    [config.stacks, selectedStackId],
  )

  async function runQuick() {
    setBusy(true)
    try {
      const r = await api.converter.transform({ input, algorithm: quickAlgorithm })
      setOutput(r.output)
    } finally {
      setBusy(false)
    }
  }

  async function runStack() {
    if (!selectedStack) return
    setBusy(true)
    try {
      // Run the stack as currently edited in UI, even if not saved yet.
      const r = await api.converter.runStack({ input, stack: selectedStack })
      setOutput(r.output)
    } catch (e) {
      setOutput(e instanceof Error ? e.message : 'Failed to run stack')
      throw e
    } finally {
      setBusy(false)
    }
  }

  async function saveConfig(next: ConverterConfig) {
    const p = await api.project.update({ converter: normalizeConverterConfig(next) })
    syncProject(p)
  }

  function updateStack(stackId: string, updater: (s: ConvertStack) => ConvertStack) {
    setConfig((prev) => ({
      stacks: prev.stacks.map((s) => (s.id === stackId ? updater(s) : s)),
    }))
  }

  async function persist() {
    await saveConfig(config)
  }

  function addStack() {
    const id = crypto.randomUUID()
    const next: ConverterConfig = {
      stacks: [{ id, name: 'New Stack', steps: [{ id: crypto.randomUUID(), algorithm: 'base64_decode', enabled: true }] }, ...config.stacks],
    }
    setConfig(next)
    setSelectedStackId(id)
  }

  function removeStack(id: string) {
    const next = { stacks: config.stacks.filter((s) => s.id !== id) }
    setConfig(next)
    if (selectedStackId === id) setSelectedStackId(next.stacks[0]?.id ?? '')
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        {(['quick', 'stack'] as ConverterTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
              activeTab === tab ? 'bg-primary/20 border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {tab === 'quick' ? 'Converter' : 'ConvertStack'}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => copyText(output, 'Copied output')}
            className="px-2.5 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground flex items-center gap-1.5"
          >
            <Copy size={12} /> Copy Output
          </button>
          <button
            onClick={() => { setInput(output); setOutput('') }}
            className="px-2.5 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground flex items-center gap-1.5"
          >
            <RefreshCcw size={12} /> Output to Input
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {activeTab === 'stack' && (
          <div className="w-72 border-r border-border p-3 overflow-y-auto space-y-2">
            <button onClick={addStack} className="w-full px-2.5 py-1.5 rounded-md text-xs border border-border hover:text-foreground text-muted-foreground flex items-center justify-center gap-1.5">
              <Plus size={12} /> Add New Stack
            </button>
            {config.stacks.map((stack) => (
              <button
                key={stack.id}
                onClick={() => setSelectedStackId(stack.id)}
                className={cn(
                  'w-full text-left px-2.5 py-2 rounded-md border',
                  selectedStackId === stack.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/30',
                )}
              >
                <div className="text-xs font-medium truncate">{stack.name}</div>
                <div className="text-[11px] text-muted-foreground">{stack.steps.length} steps</div>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="grid grid-cols-2 gap-0 flex-1 min-h-0">
            <div className="border-r border-border p-3 flex flex-col min-h-0">
              <div className="text-xs text-muted-foreground mb-1">Input</div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1 min-h-0 w-full bg-background border border-border rounded-md p-3 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                spellCheck={false}
              />
            </div>
            <div className="p-3 flex flex-col min-h-0">
              <div className="text-xs text-muted-foreground mb-1">Output</div>
              <textarea
                value={output}
                onChange={(e) => setOutput(e.target.value)}
                className="flex-1 min-h-0 w-full bg-background border border-border rounded-md p-3 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="border-t border-border p-3">
            {activeTab === 'quick' ? (
              <div className="flex items-center gap-2">
                <Select
                  value={quickAlgorithm}
                  onChange={setQuickAlgorithm}
                  options={algorithms.map((a) => ({ value: a.id, label: a.label }))}
                  className="min-w-56 h-[30px]"
                  searchable
                  searchPlaceholder="Search algorithms..."
                />
                <button
                  onClick={() => runQuick().catch(console.error)}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 flex items-center gap-1.5"
                >
                  <Play size={12} /> Run
                </button>
              </div>
            ) : selectedStack ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={selectedStack.name}
                    onChange={(e) => updateStack(selectedStack.id, (s) => ({ ...s, name: e.target.value }))}
                    className="bg-background border border-border rounded-md px-2 py-1.5 text-xs flex-1"
                  />
                  <button onClick={() => removeStack(selectedStack.id)} className="px-2 py-1.5 rounded-md border border-border text-red-400 hover:bg-red-500/10">
                    <Trash2 size={12} />
                  </button>
                  <button onClick={() => persist().catch(console.error)} className="px-2.5 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground">
                    Save
                  </button>
                  <button
                    onClick={() => runStack().catch(console.error)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 flex items-center gap-1.5"
                  >
                    <Play size={12} /> Run Stack
                  </button>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {selectedStack.steps.map((step, idx) => (
                    <div key={step.id} className="flex items-center gap-2 p-2 rounded-md border border-border bg-card/40">
                      <input
                        type="checkbox"
                        checked={step.enabled}
                        onChange={(e) => updateStack(selectedStack.id, (s) => ({ ...s, steps: s.steps.map((x) => x.id === step.id ? { ...x, enabled: e.target.checked } : x) }))}
                      />
                      <Select
                        value={step.algorithm}
                        onChange={(value) => updateStack(selectedStack.id, (s) => ({ ...s, steps: s.steps.map((x) => x.id === step.id ? { ...x, algorithm: value } : x) }))}
                        options={algorithms.map((a) => ({ value: a.id, label: a.label }))}
                        className="flex-1 h-[28px]"
                        searchable
                        searchPlaceholder="Search algorithms..."
                      />
                      <button
                        onClick={() => updateStack(selectedStack.id, (s) => {
                          if (idx === 0) return s
                          const steps = [...s.steps]
                          ;[steps[idx-1], steps[idx]] = [steps[idx], steps[idx-1]]
                          return { ...s, steps }
                        })}
                        className="p-1 rounded hover:bg-muted/40"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        onClick={() => updateStack(selectedStack.id, (s) => {
                          if (idx >= s.steps.length-1) return s
                          const steps = [...s.steps]
                          ;[steps[idx+1], steps[idx]] = [steps[idx], steps[idx+1]]
                          return { ...s, steps }
                        })}
                        className="p-1 rounded hover:bg-muted/40"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        onClick={() => updateStack(selectedStack.id, (s) => ({ ...s, steps: s.steps.filter((x) => x.id !== step.id) }))}
                        className="p-1 rounded text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => updateStack(selectedStack.id, (s) => ({ ...s, steps: [...s.steps, { id: crypto.randomUUID(), algorithm: 'base64_decode', enabled: true }] }))}
                  className="px-2.5 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
                >
                  <Plus size={12} /> Add Step
                </button>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Create a stack to start stacking algorithms.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function normalizeConverterConfig(config?: ConverterConfig | null): ConverterConfig {
  if (!config || !Array.isArray(config.stacks)) return emptyConfig
  return {
    stacks: config.stacks.map((stack) => ({
      ...stack,
      steps: Array.isArray(stack.steps) ? stack.steps : [],
    })),
  }
}
