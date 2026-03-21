import { Plus, X } from 'lucide-react'
import type { IntruderSession } from '@/store/intruder'

interface Props {
  sessions: IntruderSession[]
  activeId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
}

export function SessionTabs({ sessions, activeId, onSelect, onAdd, onClose }: Props) {
  return (
    <div className="flex items-center gap-1 border-b border-border bg-card px-2 pt-2 overflow-x-auto shrink-0">
      {sessions.map((sess) => (
        <div
          key={sess.id}
          className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-sm cursor-pointer select-none border-b-2 transition-colors whitespace-nowrap ${
            sess.id === activeId
              ? 'border-primary text-foreground bg-background'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
          onClick={() => onSelect(sess.id)}
        >
          <span className="flex items-center gap-1.5">
            {sess.status === 'running' && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
            )}
            {sess.status === 'done' && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            )}
            {sess.name}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(sess.id) }}
            className="opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-red-500/20 hover:text-red-400 transition-colors"
          >
            <X size={11} />
          </button>
        </div>
      ))}

      <button
        onClick={onAdd}
        title="New session"
        className="flex items-center gap-1 px-2 py-1.5 rounded-t-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs shrink-0 mb-0"
      >
        <Plus size={14} />
        New
      </button>
    </div>
  )
}
