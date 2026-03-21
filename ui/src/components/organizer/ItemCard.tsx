import { useState } from 'react'
import { useContextMenu } from '@/hooks/useContextMenu'
import { GripVertical, StickyNote, X, Highlighter, RotateCcw, Trash2, GitBranch, FolderPlus, Target } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import { MethodBadge } from '@/components/common/MethodBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { NoteEditor } from './NoteEditor'
import { FOLDER_COLOR_CLASSES } from './OrganizerIcons'
import { AddToFlowModal } from '@/components/flows/AddToFlowModal'
import { AddToOrganizerModal } from '@/components/organizer/AddToOrganizerModal'
import { api, type ScopeRule } from '@/api/client'
import { useProxyStore } from '@/store/proxy'
import { useOrganizerStore } from '@/store/organizer'
import { parseRequestTags, REQUEST_TAG_HIGHLIGHTED } from '@/lib/requestTags'
import type { OrganizerItem, OrganizerColor } from '@/api/client'

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function buildExcludeRule(kind: 'entirely' | 'host' | 'path' | 'subpath', req: NonNullable<OrganizerItem['request']>): ScopeRule {
  function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
  switch (kind) {
    case 'entirely': return { enabled: true, pattern_type: 'exact', host: req.host, path: req.path }
    case 'host':     return { enabled: true, pattern_type: 'exact', host: req.host, path: '' }
    case 'path':     return { enabled: true, pattern_type: 'regex', host: '.*', path: `^${escapeRegex(req.path)}$` }
    case 'subpath':  return { enabled: true, pattern_type: 'regex', host: `^${escapeRegex(req.host)}$`, path: `^${escapeRegex(req.path)}` }
  }
}

interface Props {
  item: OrganizerItem
  selected: boolean
  folderColor: OrganizerColor
  onSelect: () => void
  onRemove: () => void
  onNoteChange: (note: string) => void
  onNoteSave: () => void
  sortable?: boolean
}

export function ItemCard({ item, selected, folderColor, onSelect, onRemove, onNoteChange, onNoteSave, sortable = true }: Props) {
  const [showNote, setShowNote] = useState(false)
  const { open: contextMenuOpen, openMenu, close: closeContextMenu, menuRef } = useContextMenu()
  const [addToFlowOpen, setAddToFlowOpen] = useState(false)
  const [addToOrganizerOpen, setAddToOrganizerOpen] = useState(false)

  const colorCls = FOLDER_COLOR_CLASSES[folderColor]
  const req = item.request

  const project = useProxyStore((s) => s.project)
  const setProject = useProxyStore((s) => s.setProject)
  const replayQueue = useProxyStore((s) => s.replayQueue)
  const addToReplay = useProxyStore((s) => s.addToReplay)
  const removeRequestFromReplay = useProxyStore((s) => s.removeRequestFromReplay)
  const updateRequest = useProxyStore((s) => s.updateRequest)
  const upsertItem = useOrganizerStore((s) => s.upsertItem)

  const inReplay = req ? replayQueue.some((e) => e.request.id === req.id) : false
  const highlighted = req ? parseRequestTags(req).includes(REQUEST_TAG_HIGHLIGHTED) : false

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !sortable })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (!req) return
    openMenu(e)
  }

  async function handleToggleHighlight() {
    if (!req) return
    const tags = parseRequestTags(req)
    const next = highlighted
      ? tags.filter((t) => t !== REQUEST_TAG_HIGHLIGHTED)
      : [...tags, REQUEST_TAG_HIGHLIGHTED]
    try {
      const updated = await api.requests.updateTags(req.id, next)
      updateRequest(updated)
      upsertItem({ ...item, request: updated })
    } catch {
      toast.error('Failed to update highlight')
    }
  }

  async function addExcludeRule(kind: 'entirely' | 'host' | 'path' | 'subpath') {
    if (!req) return
    const scope = project?.scope ?? { enabled: false, include_rules: [], exclude_rules: [] }
    const rule = buildExcludeRule(kind, req)
    try {
      const updated = await api.project.update({ scope: { ...scope, exclude_rules: [...scope.exclude_rules, rule] } })
      setProject(updated)
      toast.success('Scope rule added')
    } catch {
      toast.error('Failed to update scope')
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-lg border transition-all duration-100 animate-in fade-in-50 slide-in-from-top-1 ${
        selected
          ? `${colorCls.bg} ${colorCls.border} border-l-2`
          : 'bg-zinc-800/40 border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800/70'
      }`}
      onContextMenu={handleContextMenu}
    >
      <div
        className="flex items-start gap-2 p-2.5 cursor-pointer"
        onClick={onSelect}
      >
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="mt-0.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {req && <MethodBadge method={req.method} />}
            {req?.response && <StatusBadge code={req.response.status_code} />}
            {highlighted && <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.6)]" />}
            <span className="text-xs text-zinc-400 truncate font-mono">
              {req ? `${req.host}${req.path}` : `Request #${item.request_id}`}
            </span>
          </div>
          {req && (
            <div className="text-xs text-zinc-600 mt-0.5">
              {relativeTime(req.timestamp)}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          {item.note && (
            <span className={`p-0.5 rounded ${colorCls.text}`}>
              <StickyNote size={12} />
            </span>
          )}
          <button
            onClick={() => setShowNote((v) => !v)}
            className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Toggle note"
          >
            <StickyNote size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="p-1 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors"
            title="Remove from folder"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Inline note */}
      {showNote && (
        <div className="px-2.5 pb-2.5 pt-0">
          <NoteEditor
            value={item.note}
            onChange={onNoteChange}
            onSave={onNoteSave}
            placeholder="Add a note for this request…"
            height={120}
          />
        </div>
      )}

      {/* Context menu */}
      {contextMenuOpen && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[240px] rounded-lg border border-border bg-card py-1 shadow-lg"
          style={{ left: 0, top: 0 }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
          {req && (
            <>
              <button
                onClick={() => { handleToggleHighlight(); closeContextMenu() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <Highlighter size={14} className={highlighted ? 'text-amber-300' : undefined} />
                {highlighted ? 'Remove highlight' : 'Highlight in history'}
              </button>

              {inReplay ? (
                <button
                  onClick={() => { removeRequestFromReplay(req.id); closeContextMenu() }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  <Trash2 size={14} />
                  Remove from Replay
                </button>
              ) : (
                <button
                  onClick={() => { addToReplay(req); closeContextMenu() }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  <RotateCcw size={14} />
                  Send to Replay
                </button>
              )}

              <button
                onClick={() => { setAddToFlowOpen(true); closeContextMenu() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <GitBranch size={14} />
                Send to Flow
              </button>

              <button
                onClick={() => { setAddToOrganizerOpen(true); closeContextMenu() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <FolderPlus size={14} />
                Manage in Organizer
              </button>

              <div className="my-1 border-t border-border" />

              <div className="px-3 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Remove from Scope
                </span>
              </div>

              {([
                { kind: 'entirely', label: 'Remove entirely',  desc: 'exact host + exact path' },
                { kind: 'host',     label: 'Remove host',      desc: 'exact host, any path' },
                { kind: 'path',     label: 'Remove path',      desc: 'exact path, any host' },
                { kind: 'subpath',  label: 'Remove sub-path',  desc: 'exact host, path + all sub-paths' },
              ] as const).map(({ kind, label, desc }) => (
                <button
                  key={kind}
                  onClick={() => { addExcludeRule(kind).catch(console.error); closeContextMenu() }}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <Target size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="text-sm">{label}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                </button>
              ))}

              <div className="my-1 border-t border-border" />
            </>
          )}

          <button
            onClick={() => { onRemove(); closeContextMenu() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-muted"
          >
            <X size={14} />
            Remove from folder
          </button>
        </div>
      )}

      {/* Sub-modals */}
      {req && (
        <>
          <AddToFlowModal
            open={addToFlowOpen}
            request={req}
            onClose={() => setAddToFlowOpen(false)}
          />
          <AddToOrganizerModal
            open={addToOrganizerOpen}
            requestId={req.id}
            onClose={() => setAddToOrganizerOpen(false)}
          />
        </>
      )}
    </div>
  )
}
