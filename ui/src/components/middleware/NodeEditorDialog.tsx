import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import Editor from '@monaco-editor/react'
import { X, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/Checkbox'
import { Select } from '@/components/ui/Select'
import type { MiddlewareNode } from '@/api/client'

const TYPE_OPTIONS = [
  { value: 'request',  label: 'Request' },
  { value: 'response', label: 'Response' },
  { value: 'ws_c2s',   label: 'WS Client→Server' },
  { value: 'ws_s2c',   label: 'WS Server→Client' },
]

const DEFAULT_CODE: Record<string, string> = {
  request: `def process(packet):
    # packet.method  - HTTP method (str)
    # packet.url     - full URL (str)
    # packet.headers - dict of header lists
    # packet.body    - bytes
    return packet
`,
  response: `def process(packet):
    # packet.status_code  - int
    # packet.status_text  - str
    # packet.headers      - dict of header lists
    # packet.body         - bytes
    return packet
`,
  ws_c2s: `def process(packet):
    # packet.direction - "ws_c2s"
    # packet.opcode    - int (1=text, 2=binary)
    # packet.payload   - bytes
    return packet
`,
  ws_s2c: `def process(packet):
    # packet.direction - "ws_s2c"
    # packet.opcode    - int (1=text, 2=binary)
    # packet.payload   - bytes
    return packet
`,
}

interface NodeEditorDialogProps {
  node: MiddlewareNode | null
  open: boolean
  onClose: () => void
  onSave: (node: MiddlewareNode) => void
  onDelete: (id: string) => void
}

export function NodeEditorDialog({ node, open, onClose, onSave, onDelete }: NodeEditorDialogProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<MiddlewareNode['type']>('request')
  const [enabled, setEnabled] = useState(true)
  const [code, setCode] = useState('')

  useEffect(() => {
    if (node) {
      setName(node.name)
      setType(node.type)
      setEnabled(node.enabled)
      setCode(node.code || DEFAULT_CODE[node.type] || DEFAULT_CODE.request)
    }
  }, [node])

  const handleTypeChange = (newType: string) => {
    const t = newType as MiddlewareNode['type']
    setType(t)
    if (!code || code === DEFAULT_CODE[type]) {
      setCode(DEFAULT_CODE[t] || DEFAULT_CODE.request)
    }
  }

  const handleSave = () => {
    if (!node) return
    onSave({ ...node, name, type, enabled, code })
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed inset-4 md:inset-8 bg-card border border-border rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <Dialog.Title className="text-sm font-semibold text-foreground">Edit Middleware Node</Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex flex-1 overflow-hidden">
            {/* Left panel: settings + docs */}
            <div className="w-64 flex-shrink-0 border-r border-border flex flex-col overflow-y-auto p-4 gap-4">
              {/* Name */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="My Node"
                />
              </div>

              {/* Type */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <Select
                  value={type}
                  onChange={handleTypeChange}
                  options={TYPE_OPTIONS}
                  className="w-full"
                />
              </div>

              {/* Enabled */}
              <div className="flex items-center gap-2">
                <Checkbox checked={enabled} onChange={setEnabled} />
                <span className="text-xs text-foreground">Enabled</span>
              </div>

              {/* Docs */}
              <div className="mt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Packet API</p>
                <div className="text-[10px] text-muted-foreground space-y-1 leading-relaxed font-mono">
                  {type === 'request' && (
                    <>
                      <p><span className="text-foreground">packet.method</span> str</p>
                      <p><span className="text-foreground">packet.url</span> str</p>
                      <p><span className="text-foreground">packet.headers</span> dict</p>
                      <p><span className="text-foreground">packet.body</span> bytes</p>
                    </>
                  )}
                  {type === 'response' && (
                    <>
                      <p><span className="text-foreground">packet.status_code</span> int</p>
                      <p><span className="text-foreground">packet.status_text</span> str</p>
                      <p><span className="text-foreground">packet.headers</span> dict</p>
                      <p><span className="text-foreground">packet.body</span> bytes</p>
                    </>
                  )}
                  {(type === 'ws_c2s' || type === 'ws_s2c') && (
                    <>
                      <p><span className="text-foreground">packet.direction</span> str</p>
                      <p><span className="text-foreground">packet.opcode</span> int</p>
                      <p><span className="text-foreground">packet.payload</span> bytes</p>
                    </>
                  )}
                  <p className="mt-2 text-muted-foreground/70">Return the modified packet (or None to skip).</p>
                </div>
              </div>

              {/* Delete */}
              <div className="mt-auto pt-4 border-t border-border">
                <button
                  onClick={() => { if (node) { onDelete(node.id); onClose() } }}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-red-400 hover:bg-red-500/10 transition-colors w-full"
                >
                  <Trash2 size={12} />
                  Delete Node
                </button>
              </div>
            </div>

            {/* Monaco editor */}
            <div className="flex-1 overflow-hidden">
              <Editor
                defaultLanguage="python"
                value={code}
                onChange={(v) => setCode(v ?? '')}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  tabSize: 4,
                }}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className={cn(
                'px-4 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors'
              )}
            >
              Save Node
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
