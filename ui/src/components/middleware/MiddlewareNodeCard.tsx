import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Code2, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/Checkbox'
import type { MiddlewareNode } from '@/api/client'

const TYPE_BORDER: Record<string, string> = {
  request:  'border-l-blue-500',
  response: 'border-l-purple-500',
  ws_c2s:   'border-l-green-500',
  ws_s2c:   'border-l-orange-500',
}

const TYPE_LABELS: Record<string, string> = {
  request:  'Request',
  response: 'Response',
  ws_c2s:   'WS Client→Server',
  ws_s2c:   'WS Server→Client',
}

export interface MiddlewareNodeData extends MiddlewareNode {
  onEdit: (id: string) => void
  onToggle: (id: string) => void
}

function MiddlewareNodeCardInner({ data }: NodeProps) {
  const nd = data as unknown as MiddlewareNodeData

  return (
    <div
      className={cn(
        'min-w-[190px] max-w-[250px] rounded-lg border border-border bg-card shadow-md',
        'border-l-4',
        TYPE_BORDER[nd.type] ?? 'border-l-muted-foreground',
        !nd.enabled && 'opacity-50',
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-2.5 !h-2.5" />

      {/* Title row */}
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Code2 size={13} className="text-muted-foreground flex-shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate">
            {nd.name || 'Unnamed Node'}
          </span>
        </div>

        {/* Interactive controls — nodrag prevents RF from capturing these as drag targets */}
        <div className="nodrag nopan flex items-center gap-1.5 flex-shrink-0">
          <Checkbox
            checked={nd.enabled}
            onChange={() => nd.onToggle(nd.id)}
            title={nd.enabled ? 'Disable node' : 'Enable node'}
          />
          <button
            onClick={() => nd.onEdit(nd.id)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            title="Edit node"
          >
            <Pencil size={11} />
          </button>
        </div>
      </div>

      {/* Type badge */}
      <div className="px-3 pb-2.5">
        <span className="text-[10px] text-muted-foreground">
          {TYPE_LABELS[nd.type] ?? nd.type}
        </span>
      </div>

      <Handle type="source" position={Position.Right} className="!bg-muted-foreground !w-2.5 !h-2.5" />
    </div>
  )
}

export const MiddlewareNodeCard = memo(MiddlewareNodeCardInner)
