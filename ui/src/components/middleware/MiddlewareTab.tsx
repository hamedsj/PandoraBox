import { useState, useCallback, useEffect } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { AlertCircle, Cpu } from 'lucide-react'
import { api, type MiddlewareConfig, type MiddlewareNode, type MiddlewareEdge } from '@/api/client'
import { useProxyStore } from '@/store/proxy'
import { Checkbox } from '@/components/ui/Checkbox'
import { MiddlewareGraph } from './MiddlewareGraph'
import { NodeEditorDialog } from './NodeEditorDialog'
import { cn } from '@/lib/utils'

const DEFAULT_TEMPLATES: Record<MiddlewareNode['type'], string> = {
  request: `def process(packet):
    """
    HTTP Request Middleware

    packet.method   (str)   HTTP method: "GET", "POST", "PUT", etc.
    packet.url      (str)   Full URL: "https://example.com/path?q=1"
    packet.headers  (dict)  Headers: {"Content-Type": ["application/json"]}
    packet.body     (bytes) Request body bytes
    """
    return packet`,
  response: `def process(packet):
    """
    HTTP Response Middleware

    packet.status_code (int)   HTTP status: 200, 404, 500, etc.
    packet.status_text (str)   Status line: "200 OK"
    packet.headers     (dict)  Response headers
    packet.body        (bytes) Response body bytes
    """
    return packet`,
  ws_c2s: `def process(packet):
    """
    WebSocket Client→Server Frame Middleware
    Active rewrite: the peer receives your returned payload.

    packet.direction  (str)   Always "ws_c2s"
    packet.opcode     (int)   WebSocket frame opcode (1=text, 2=binary, 0=continuation, etc.)
    packet.payload    (bytes) Unmasked frame payload
    """
    return packet`,
  ws_s2c: `def process(packet):
    """
    WebSocket Server→Client Frame Middleware
    Active rewrite: the browser receives your returned payload.

    packet.direction  (str)   Always "ws_s2c"
    packet.opcode     (int)   WebSocket frame opcode (1=text, 2=binary, 0=continuation, etc.)
    packet.payload    (bytes) Frame payload bytes
    """
    return packet`,
}

function newNode(type: MiddlewareNode['type'], existingCount: number): MiddlewareNode {
  return {
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    name: 'New Node',
    enabled: true,
    code: DEFAULT_TEMPLATES[type],
    position: { x: 80 + existingCount * 240, y: 120 },
  }
}

function emptyConfig(): MiddlewareConfig {
  return { enabled: false, nodes: [], edges: [] }
}

const tabTriggerClass = cn(
  'px-4 py-2 text-sm font-medium transition-colors rounded-t-md',
  'data-[state=active]:bg-muted data-[state=active]:text-foreground',
  'data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground',
)

export function MiddlewareTab() {
  const project = useProxyStore((s) => s.project)
  const setProject = useProxyStore((s) => s.setProject)

  const [local, setLocal] = useState<MiddlewareConfig>(emptyConfig)
  const [saved, setSaved] = useState<MiddlewareConfig>(emptyConfig)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingNode, setEditingNode] = useState<MiddlewareNode | null>(null)
  const [trafficTab, setTrafficTab] = useState<'http' | 'ws'>('http')

  const load = useCallback((cfg: MiddlewareConfig) => {
    const safe: MiddlewareConfig = {
      enabled: cfg.enabled ?? false,
      nodes: cfg.nodes ?? [],
      edges: cfg.edges ?? [],
    }
    setLocal(safe)
    setSaved(safe)
  }, [])

  useEffect(() => {
    if (project?.middleware) {
      load(project.middleware)
    } else {
      api.project.get().then((p) => load(p.middleware ?? emptyConfig())).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.path, project?.middleware])

  const isDirty = JSON.stringify(local) !== JSON.stringify(saved)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const updated = await api.project.update({ middleware: local })
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

  const addNode = useCallback((type: MiddlewareNode['type']) => {
    setLocal((prev) => {
      const count = prev.nodes.filter((n) => n.type === type).length
      const n = newNode(type, count)
      const updated = { ...prev, nodes: [...prev.nodes, n] }
      // Open editor for new node after state settles
      setTimeout(() => setEditingNode(n), 0)
      return updated
    })
  }, [])

  const updateNode = useCallback((updated: MiddlewareNode) => {
    setLocal((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === updated.id ? updated : n)),
    }))
    setEditingNode(null)
  }, [])

  const toggleNode = useCallback((id: string) => {
    setLocal((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n)),
    }))
  }, [])

  const deleteNode = useCallback((id: string) => {
    setLocal((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== id),
      edges: prev.edges.filter((e) => e.source !== id && e.target !== id),
    }))
  }, [])

  const handleNodesChange = useCallback(
    (visibleTypes: MiddlewareNode['type'][], nodes: MiddlewareNode[]) => {
      setLocal((prev) => ({
        ...prev,
        nodes: [
          ...prev.nodes.filter((n) => !visibleTypes.includes(n.type)),
          ...nodes,
        ],
      }))
    },
    [],
  )

  const handleEdgesChange = useCallback((_visibleTypes: MiddlewareNode['type'][], edges: MiddlewareEdge[]) => {
    setLocal((prev) => ({ ...prev, edges }))
  }, [])

  const nodesOfTypes = (types: MiddlewareNode['type'][]) =>
    local.nodes.filter((n) => types.includes(n.type))

  const edgesOfTypes = (types: MiddlewareNode['type'][]) => {
    const ids = new Set(nodesOfTypes(types).map((n) => n.id))
    return local.edges.filter((e) => ids.has(e.source) || ids.has(e.target))
  }

  const httpNodes = nodesOfTypes(['request', 'response'])
  const wsNodes   = nodesOfTypes(['ws_c2s', 'ws_s2c'])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <Cpu size={16} className="text-primary" />
          <span className="text-sm font-semibold text-foreground">Middleware Pipeline</span>
          {isDirty && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500 font-medium">
              Unsaved
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox
            checked={local.enabled}
            onChange={(v) => setLocal((prev) => ({ ...prev, enabled: v }))}
          />
          <span className="text-xs text-foreground">Enable middleware</span>
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 mx-6 mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex-shrink-0">
          <AlertCircle size={13} />
          {error}
        </div>
      )}

      {/* Traffic tabs — each canvas fills all remaining space */}
      <Tabs.Root
        value={trafficTab}
        onValueChange={(v) => setTrafficTab(v as 'http' | 'ws')}
        className="flex flex-col flex-1 min-h-0"
      >
        <Tabs.List className="flex gap-1 px-6 pt-3 pb-0 flex-shrink-0">
          <Tabs.Trigger value="http" className={tabTriggerClass}>
            HTTP
            <span className="ml-1.5 text-[10px] text-muted-foreground">({httpNodes.length})</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="ws" className={tabTriggerClass}>
            WebSocket
            <span className="ml-1.5 text-[10px] text-muted-foreground">({wsNodes.length})</span>
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content
          value="http"
          className="flex-1 min-h-0"
        >
          <MiddlewareGraph
            nodes={nodesOfTypes(['request', 'response'])}
            edges={edgesOfTypes(['request', 'response'])}
            visibleTypes={['request', 'response']}
            onNodesChange={(nodes) => handleNodesChange(['request', 'response'], nodes)}
            onEdgesChange={(edges) => handleEdgesChange(['request', 'response'], edges)}
            onEditNode={(id) => {
              const n = local.nodes.find((node) => node.id === id)
              if (n) setEditingNode(n)
            }}
            onToggleNode={toggleNode}
            onAddNode={addNode}
          />
        </Tabs.Content>

        <Tabs.Content
          value="ws"
          className="flex-1 min-h-0"
        >
          <MiddlewareGraph
            nodes={nodesOfTypes(['ws_c2s', 'ws_s2c'])}
            edges={edgesOfTypes(['ws_c2s', 'ws_s2c'])}
            visibleTypes={['ws_c2s', 'ws_s2c']}
            onNodesChange={(nodes) => handleNodesChange(['ws_c2s', 'ws_s2c'], nodes)}
            onEdgesChange={(edges) => handleEdgesChange(['ws_c2s', 'ws_s2c'], edges)}
            onEditNode={(id) => {
              const n = local.nodes.find((node) => node.id === id)
              if (n) setEditingNode(n)
            }}
            onToggleNode={toggleNode}
            onAddNode={addNode}
          />
        </Tabs.Content>
      </Tabs.Root>

      {/* Save/discard footer */}
      {isDirty && (
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-border flex-shrink-0">
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

      <NodeEditorDialog
        node={editingNode}
        open={editingNode !== null}
        onClose={() => setEditingNode(null)}
        onSave={updateNode}
        onDelete={deleteNode}
      />
    </div>
  )
}
