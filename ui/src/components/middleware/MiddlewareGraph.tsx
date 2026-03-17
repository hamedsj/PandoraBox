import { useCallback, useEffect, useRef } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnConnect,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Plus } from 'lucide-react'
import { MiddlewareNodeCard } from './MiddlewareNodeCard'
import type { MiddlewareNode, MiddlewareEdge } from '@/api/client'

const nodeTypes = { middlewareNode: MiddlewareNodeCard }

const TYPE_LABELS: Record<MiddlewareNode['type'], string> = {
  request:  'Request',
  response: 'Response',
  ws_c2s:   'Client → Server',
  ws_s2c:   'Server → Client',
}

function toFlowNodes(
  nodes: MiddlewareNode[],
  onEdit: (id: string) => void,
  onToggle: (id: string) => void,
): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    type: 'middlewareNode',
    position: n.position,
    data: { ...n, onEdit, onToggle } as Record<string, unknown>,
  }))
}

function toFlowEdges(edges: MiddlewareEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
  }))
}

interface MiddlewareGraphProps {
  nodes: MiddlewareNode[]
  edges: MiddlewareEdge[]
  visibleTypes: MiddlewareNode['type'][]
  onNodesChange: (nodes: MiddlewareNode[]) => void
  onEdgesChange: (edges: MiddlewareEdge[]) => void
  onEditNode: (id: string) => void
  onToggleNode: (id: string) => void
  onAddNode: (type: MiddlewareNode['type']) => void
}

export function MiddlewareGraph({
  nodes,
  edges,
  visibleTypes,
  onNodesChange,
  onEdgesChange,
  onEditNode,
  onToggleNode,
  onAddNode,
}: MiddlewareGraphProps) {
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState(
    toFlowNodes(nodes, onEditNode, onToggleNode),
  )
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState(
    toFlowEdges(edges),
  )

  const prevNodeKeyRef = useRef(nodes.map((n) => n.id).join(','))
  useEffect(() => {
    const key = nodes.map((n) => n.id).join(',')
    if (key !== prevNodeKeyRef.current) {
      // Structural change (add/delete) — full re-sync including positions
      prevNodeKeyRef.current = key
      setRfNodes(toFlowNodes(nodes, onEditNode, onToggleNode))
    } else {
      // Data-only change (enabled toggle, rename, etc.) — update data but preserve RF positions
      setRfNodes((current) =>
        current.map((rfn) => {
          const prop = nodes.find((n) => n.id === rfn.id)
          if (!prop) return rfn
          return {
            ...rfn,
            data: { ...prop, onEdit: onEditNode, onToggle: onToggleNode } as Record<string, unknown>,
          }
        }),
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes])

  // Sync edges when IDs change
  const prevEdgeKeyRef = useRef(edges.map((e) => e.id).join(','))
  useEffect(() => {
    const key = edges.map((e) => e.id).join(',')
    if (key !== prevEdgeKeyRef.current) {
      prevEdgeKeyRef.current = key
      setRfEdges(toFlowEdges(edges))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges])

  // Persist the dragged node's new position — only touch that node
  const handleNodeDragStop = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      onNodesChange(
        nodes.map((n) => (n.id === node.id ? { ...n, position: node.position } : n)),
      )
    },
    [nodes, onNodesChange],
  )

  // Persist edge deletions
  const handleEdgesChange: typeof onRfEdgesChange = useCallback(
    (changes) => {
      onRfEdgesChange(changes)
      const hasRemoval = changes.some((c) => c.type === 'remove')
      if (hasRemoval) {
        setRfEdges((eds) => {
          const mapped: MiddlewareEdge[] = eds.map((e) => ({
            id: e.id,
            source: e.source ?? '',
            target: e.target ?? '',
          }))
          onEdgesChange(mapped)
          return eds
        })
      }
    },
    [onRfEdgesChange, onEdgesChange, setRfEdges],
  )

  const handleConnect: OnConnect = useCallback(
    (connection) => {
      setRfEdges((eds) => {
        const newEdges = addEdge({ ...connection, type: 'smoothstep' }, eds)
        const mapped: MiddlewareEdge[] = newEdges.map((e) => ({
          id: e.id,
          source: e.source ?? '',
          target: e.target ?? '',
        }))
        onEdgesChange(mapped)
        return newEdges
      })
    },
    [setRfEdges, onEdgesChange],
  )

  return (
    <div className="relative w-full h-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onRfNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
        selectNodesOnDrag={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="opacity-30" />
        <Controls className="[&_button]:bg-card [&_button]:border-border [&_button]:text-foreground" />
      </ReactFlow>

      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        {visibleTypes.map((type) => (
          <button
            key={type}
            onClick={() => onAddNode(type)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-card/90 backdrop-blur text-foreground border border-border hover:bg-muted transition-colors shadow-sm"
          >
            <Plus size={12} />
            {TYPE_LABELS[type]}
          </button>
        ))}
      </div>
    </div>
  )
}
