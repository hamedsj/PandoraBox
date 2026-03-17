import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { X, Plus, GitBranch } from 'lucide-react'
import { useFlowsStore } from '@/store/flows'
import { useProxyStore } from '@/store/proxy'
import { api } from '@/api/client'
import type { Flow, FlowStep, Request } from '@/api/client'
import { cn } from '@/lib/utils'

function formatRequestToRaw(req: Request): string {
  const path = req.path || '/'
  const query = req.query ? `?${req.query}` : ''
  const lines: string[] = []
  lines.push(`${req.method} ${path}${query} HTTP/1.1`)
  lines.push(`Host: ${req.host}`)

  if (req.headers) {
    try {
      const hdrs = JSON.parse(req.headers) as Record<string, string | string[]>
      for (const [k, v] of Object.entries(hdrs)) {
        if (k.toLowerCase() !== 'host') {
          const val = Array.isArray(v) ? v.join(', ') : String(v)
          lines.push(`${k}: ${val}`)
        }
      }
    } catch {
      // ignore
    }
  }

  lines.push('')
  if (req.body) {
    lines.push(typeof req.body === 'string' ? req.body : '')
  }

  return lines.join('\r\n')
}

interface AddToFlowModalProps {
  open: boolean
  request: Request | null
  onClose: () => void
}

export function AddToFlowModal({ open, request, onClose }: AddToFlowModalProps) {
  const { flows, upsertFlow } = useFlowsStore()
  const setProject = useProxyStore((s) => s.setProject)
  const [newFlowName, setNewFlowName] = useState('')
  const [saving, setSaving] = useState(false)

  async function addToFlow(flow: Flow) {
    if (!request) return
    setSaving(true)
    try {
      const rawText = formatRequestToRaw(request)
      const newStep: FlowStep = {
        id: `step_${Date.now()}`,
        type: 'request',
        name: `${request.method} ${request.host}${request.path}`,
        raw: btoa(rawText),
      }
      const updatedFlow: Flow = {
        ...flow,
        steps: [...flow.steps, newStep],
      }
      const updated = await api.project.update({ flows: flows.map((f) => (f.id === flow.id ? updatedFlow : f)) })
      setProject(updated)
      upsertFlow(updatedFlow)
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function createFlowAndAdd() {
    if (!request || !newFlowName.trim()) return
    setSaving(true)
    try {
      const rawText = formatRequestToRaw(request)
      const newStep: FlowStep = {
        id: `step_${Date.now()}`,
        type: 'request',
        name: `${request.method} ${request.host}${request.path}`,
        raw: btoa(rawText),
      }
      const newFlow: Flow = {
        id: `flow_${Date.now()}`,
        name: newFlowName.trim(),
        steps: [newStep],
        variables: {},
      }
      const allFlows = [...flows, newFlow]
      const updated = await api.project.update({ flows: allFlows })
      setProject(updated)
      upsertFlow(newFlow)
      setNewFlowName('')
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] max-h-[80vh] bg-card border border-border rounded-xl shadow-xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <Dialog.Title className="font-semibold text-sm flex items-center gap-2">
              <GitBranch size={16} className="text-primary" />
              Add to Flow
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Existing flows */}
            {flows.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Existing Flows</p>
                <div className="space-y-1.5">
                  {flows.map((flow) => (
                    <button
                      key={flow.id}
                      onClick={() => addToFlow(flow)}
                      disabled={saving}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border text-left transition-colors',
                        'hover:bg-muted/60 hover:border-primary/40',
                        saving && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <div>
                        <div className="text-sm font-medium">{flow.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {flow.steps.length} step{flow.steps.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <Plus size={14} className="text-muted-foreground flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Create new flow */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">New Flow</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFlowName}
                  onChange={(e) => setNewFlowName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') createFlowAndAdd() }}
                  placeholder="Flow name..."
                  className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-primary/60 placeholder:text-muted-foreground/50"
                />
                <button
                  onClick={createFlowAndAdd}
                  disabled={saving || !newFlowName.trim()}
                  className={cn(
                    'px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-colors',
                    'hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
