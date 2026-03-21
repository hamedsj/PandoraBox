import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { ChevronDown, ChevronRight, FolderOpen, Pencil, Plus } from 'lucide-react'
import { OrganizerIconDisplay, FOLDER_COLOR_CLASSES } from './OrganizerIcons'
import { NoteEditor } from './NoteEditor'
import { ItemCard } from './ItemCard'
import type { OrganizerFolder, OrganizerItem } from '@/api/client'

interface Props {
  folder: OrganizerFolder | null
  items: OrganizerItem[]
  selectedItemId: number | null
  onSelectItem: (id: number) => void
  onEditFolder: () => void
  onAddItem: () => void
  onFolderNoteChange: (note: string) => void
  onFolderNoteSave: () => void
  onItemNoteChange: (itemId: number, note: string) => void
  onItemNoteSave: (itemId: number) => void
  onRemoveItem: (itemId: number) => void
  onReorderItems: (items: OrganizerItem[]) => void
}

export function FolderDetail({
  folder,
  items,
  selectedItemId,
  onSelectItem,
  onEditFolder,
  onAddItem,
  onFolderNoteChange,
  onFolderNoteSave,
  onItemNoteChange,
  onItemNoteSave,
  onRemoveItem,
  onReorderItems,
}: Props) {
  const [noteExpanded, setNoteExpanded] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = items.findIndex((x) => x.id === active.id)
    const newIdx = items.findIndex((x) => x.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    onReorderItems(arrayMove(items, oldIdx, newIdx))
  }

  if (!folder) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
        <FolderOpen size={64} className="text-zinc-700" />
        <p className="text-zinc-400 font-medium">Select a folder</p>
        <p className="text-zinc-600 text-sm">or create a new one to get started</p>
      </div>
    )
  }

  const colorCls = FOLDER_COLOR_CLASSES[folder.color]
  const hasNote = !!folder.note

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorCls.bg} ${colorCls.border} border`}>
          <OrganizerIconDisplay iconName={folder.icon} size={20} className={colorCls.text} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-zinc-100 truncate">{folder.name}</h2>
          <p className="text-xs text-zinc-500">{items.length} request{items.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={onEditFolder}
          className="p-1.5 rounded hover:bg-zinc-700/50 text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
          title="Edit folder"
        >
          <Pencil size={14} />
        </button>
      </div>

      {/* Notes section */}
      <div className="border-b border-zinc-800">
        <button
          onClick={() => setNoteExpanded((v) => !v)}
          className="w-full px-4 py-2 flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
        >
          {noteExpanded || hasNote ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="font-medium">Notes</span>
          {hasNote && !noteExpanded && (
            <span className="text-zinc-600 truncate text-xs font-normal">{folder.note.slice(0, 60)}{folder.note.length > 60 ? '…' : ''}</span>
          )}
        </button>
        {(noteExpanded || hasNote) && (
          <div className="px-4 pb-3">
            <NoteEditor
              value={folder.note}
              onChange={onFolderNoteChange}
              onSave={onFolderNoteSave}
              placeholder="Add a folder note (Markdown)…"
              height={200}
            />
          </div>
        )}
      </div>

      {/* Requests */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">Requests ({items.length})</span>
          <button
            onClick={onAddItem}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Plus size={12} />
            Add
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
            <FolderOpen size={28} className="text-zinc-700" />
            <p className="text-xs text-zinc-600">Go to History and right-click any request to add it here</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="px-4 pb-4 space-y-1.5">
                {items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    selected={item.id === selectedItemId}
                    folderColor={folder.color}
                    onSelect={() => onSelectItem(item.id)}
                    onRemove={() => onRemoveItem(item.id)}
                    onNoteChange={(note) => onItemNoteChange(item.id, note)}
                    onNoteSave={() => onItemNoteSave(item.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  )
}
