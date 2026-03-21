import { useState } from 'react'
import { GripVertical, StickyNote, X } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { MethodBadge } from '@/components/common/MethodBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { NoteEditor } from './NoteEditor'
import { FOLDER_COLOR_CLASSES } from './OrganizerIcons'
import type { OrganizerItem, OrganizerColor } from '@/api/client'

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
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
  const colorCls = FOLDER_COLOR_CLASSES[folderColor]
  const req = item.request

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-lg border transition-all duration-100 animate-in fade-in-50 slide-in-from-top-1 ${
        selected
          ? `${colorCls.bg} ${colorCls.border} border-l-2`
          : 'bg-zinc-800/40 border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800/70'
      }`}
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
            onClick={onRemove}
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
    </div>
  )
}
