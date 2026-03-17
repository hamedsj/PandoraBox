import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Globe } from 'lucide-react'
import { MethodBadge } from '@/components/common/MethodBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Checkbox } from '@/components/ui/Checkbox'
import { cn } from '@/lib/utils'
import type { SitemapBranchNode, SitemapNode, SitemapRequestNode } from '@/lib/sitemap'
import { collectRequestIdsUnder } from '@/lib/sitemap'

interface SitemapTreeProps {
  tree: SitemapBranchNode[]
  expanded: Set<string>
  selectedRequestId: number | null
  onToggle: (id: string) => void
  onSelectRequest: (requestId: number) => void
  selectedIds: Set<number>
  onToggleSelect: (ids: number[], forceValue?: boolean) => void
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size}B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`
  return `${(size / (1024 * 1024)).toFixed(1)}MB`
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1)}…`
}

function requestLabel(node: SitemapRequestNode): string {
  if (node.occurrenceCount > 1) return 'latest capture'
  if (node.request.query) return `?${truncate(node.request.query, 56)}`
  if (node.request.path === '/') return 'root request'
  return `request #${node.request.id}`
}

function BranchRow({
  node,
  depth,
  expanded,
  selectedRequestId,
  onToggle,
  onSelectRequest,
  selectedIds,
  onToggleSelect,
}: {
  node: SitemapNode
  depth: number
  expanded: Set<string>
  selectedRequestId: number | null
  onToggle: (id: string) => void
  onSelectRequest: (requestId: number) => void
  selectedIds: Set<number>
  onToggleSelect: (ids: number[], forceValue?: boolean) => void
}) {
  const indent = depth * 16

  if (node.kind === 'request') {
    const request = node.request
    const isSelected = selectedRequestId === request.id
    const isChecked = selectedIds.has(request.id)

    return (
      <div className="space-y-1">
        <div className="relative">
          <button
            onClick={() => onSelectRequest(request.id)}
            className={cn(
              'group relative flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
              isSelected
                ? 'border-primary/50 bg-primary/12 shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]'
                : 'border-transparent hover:border-border hover:bg-muted/40'
            )}
            style={{ marginLeft: indent + 22 }}
          >
            <span
              className="mt-1 text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation()
                onToggleSelect([request.id])
              }}
            >
              <Checkbox
                checked={isChecked}
                onChange={() => onToggleSelect([request.id])}
                className="mt-0"
              />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <MethodBadge method={request.method} />
                {request.response && <StatusBadge code={request.response.status_code} />}
                <span className="truncate font-mono text-[11px] text-foreground/85">
                  {requestLabel(node)}
                </span>
                {node.occurrenceCount > 1 && (
                  <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {node.occurrenceCount}x
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="truncate font-mono">{truncate(request.path, 64)}</span>
                {request.response && <span>{formatBytes(request.response.size_bytes)}</span>}
                {request.response && <span>{request.response.duration_ms}ms</span>}
              </div>
            </div>
            <span className="rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              #{request.id}
            </span>
          </button>
        </div>
      </div>
    )
  }

  const isOpen = expanded.has(node.id)
  const Icon = node.kind === 'host' ? Globe : isOpen ? FolderOpen : Folder
  const leafIds = collectRequestIdsUnder([node])
  const selectedCount = leafIds.filter((id) => selectedIds.has(id)).length
  const allSel = leafIds.length > 0 && selectedCount === leafIds.length
  const someSel = selectedCount > 0 && !allSel

  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          'group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 transition-colors',
          node.kind === 'host'
            ? 'bg-muted/35 hover:bg-muted/50'
            : 'hover:bg-muted/35'
        )}
        style={{ marginLeft: indent }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect(leafIds, !allSel)
          }}
        >
          <Checkbox
            checked={allSel}
            indeterminate={someSel}
            onChange={() => onToggleSelect(leafIds, !allSel)}
          />
        </span>
        <button
          onClick={() => onToggle(node.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-muted-foreground transition-transform">
            {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
          <span className={cn('shrink-0', node.kind === 'host' ? 'text-primary' : 'text-muted-foreground')}>
            <Icon size={15} />
          </span>
          <span className="truncate font-medium text-foreground">{node.label}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {node.responseCount > 0 && (
              <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                {node.responseCount} rsp
              </span>
            )}
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {node.requestCount} req
            </span>
          </div>
        </button>
      </div>

      {isOpen && (
        <div className="relative ml-4 border-l border-border/70 pl-3">
          {node.children.map((child) => (
            <BranchRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedRequestId={selectedRequestId}
              onToggle={onToggle}
              onSelectRequest={onSelectRequest}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function SitemapTree({
  tree,
  expanded,
  selectedRequestId,
  onToggle,
  onSelectRequest,
  selectedIds,
  onToggleSelect,
}: SitemapTreeProps) {
  if (tree.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 px-6 text-center">
        <Globe size={34} className="mb-3 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">No in-scope traffic matches the current filters</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Capture traffic through the proxy or adjust the sitemap filters to reveal more hosts and routes.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {tree.map((node) => (
        <BranchRow
          key={node.id}
          node={node}
          depth={0}
          expanded={expanded}
          selectedRequestId={selectedRequestId}
          onToggle={onToggle}
          onSelectRequest={onSelectRequest}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  )
}
