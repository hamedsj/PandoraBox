import { useState, useRef } from 'react'
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
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronRight,
  ChevronDown,
  GripVertical,
  FolderOpen,
  Pencil,
  Trash2,
  Plus,
} from 'lucide-react'
import { OrganizerIconDisplay, FOLDER_COLOR_CLASSES } from './OrganizerIcons'
import type { OrganizerFolder } from '@/api/client'

interface FolderRowProps {
  folder: OrganizerFolder
  depth: number
  selected: boolean
  expanded: boolean
  itemCount: number
  onSelect: () => void
  onToggleExpand: () => void
  onAddSubfolder: () => void
  onEdit: () => void
  onDelete: () => void
  onRename: (name: string) => void
}

function FolderRow({
  folder,
  depth,
  selected,
  expanded,
  itemCount,
  onSelect,
  onToggleExpand,
  onAddSubfolder,
  onEdit,
  onDelete,
  onRename,
}: FolderRowProps) {
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(folder.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const colorCls = FOLDER_COLOR_CLASSES[folder.color]

  const hasChildren = (folder.children?.length ?? 0) > 0

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: folder.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const startRename = () => {
    setRenameValue(folder.name)
    setRenaming(true)
    setTimeout(() => inputRef.current?.select(), 20)
  }

  const commitRename = () => {
    const v = renameValue.trim()
    if (v && v !== folder.name) onRename(v)
    setRenaming(false)
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`group flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer transition-all ${
          selected
            ? `${colorCls.bg} ${colorCls.border} border`
            : 'hover:bg-zinc-800/60'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={onSelect}
        onDoubleClick={startRename}
      >
        {/* Drag handle */}
        <span
          {...attributes}
          {...listeners}
          className="text-zinc-600 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={12} />
        </span>

        {/* Expand chevron */}
        <button
          onClick={(e) => { e.stopPropagation(); if (hasChildren || itemCount > 0) onToggleExpand() }}
          className={`flex-shrink-0 transition-colors ${hasChildren || itemCount > 0 ? 'text-zinc-500 hover:text-zinc-300' : 'text-transparent'}`}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {/* Icon */}
        <OrganizerIconDisplay iconName={folder.icon} size={14} className={`flex-shrink-0 ${colorCls.text}`} />

        {/* Name */}
        {renaming ? (
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setRenaming(false)
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-zinc-700 border border-zinc-600 rounded px-1 py-0 text-xs text-zinc-100 focus:outline-none"
            autoFocus
          />
        ) : (
          <span className="flex-1 min-w-0 text-xs text-zinc-200 truncate">{folder.name}</span>
        )}

        {/* Count badge */}
        {itemCount > 0 && !renaming && (
          <span className="text-xs text-zinc-600 flex-shrink-0">{itemCount}</span>
        )}

        {/* Hover actions */}
        {!renaming && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onAddSubfolder}
              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Add subfolder"
            >
              <Plus size={11} />
            </button>
            <button
              onClick={onEdit}
              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Edit folder"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={onDelete}
              className="p-0.5 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors"
              title="Delete folder"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {folder.children!.map((child) => (
            <FolderRowWrapper key={child.id} folder={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// Context-aware wrapper — used for nested rendering
interface WrapperProps {
  folder: OrganizerFolder
  depth: number
}

function FolderRowWrapper({ folder, depth }: WrapperProps) {
  // This is a stub that gets replaced with full context in FolderTree
  // We'll pass handlers via props instead
  return <div data-folder-id={folder.id} data-depth={depth} />
}

interface FolderTreeProps {
  roots: OrganizerFolder[]
  selectedFolderId: number | null
  expandedFolderIds: Set<number>
  itemCountByFolder: Record<number, number>
  onSelectFolder: (id: number) => void
  onToggleExpand: (id: number) => void
  onCreateFolder: (parentId?: number) => void
  onEditFolder: (folder: OrganizerFolder) => void
  onDeleteFolder: (id: number) => void
  onRenameFolder: (id: number, name: string) => void
  onReorderFolders: (folders: OrganizerFolder[]) => void
}

export function FolderTree({
  roots,
  selectedFolderId,
  expandedFolderIds,
  itemCountByFolder,
  onSelectFolder,
  onToggleExpand,
  onCreateFolder,
  onEditFolder,
  onDeleteFolder,
  onRenameFolder,
  onReorderFolders,
}: FolderTreeProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = roots.findIndex((f) => f.id === active.id)
    const newIdx = roots.findIndex((f) => f.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    onReorderFolders(arrayMove(roots, oldIdx, newIdx))
  }

  const renderFolder = (folder: OrganizerFolder, depth: number) => (
    <FolderRow
      key={folder.id}
      folder={folder}
      depth={depth}
      selected={folder.id === selectedFolderId}
      expanded={expandedFolderIds.has(folder.id)}
      itemCount={itemCountByFolder[folder.id] ?? 0}
      onSelect={() => onSelectFolder(folder.id)}
      onToggleExpand={() => onToggleExpand(folder.id)}
      onAddSubfolder={() => onCreateFolder(folder.id)}
      onEdit={() => onEditFolder(folder)}
      onDelete={() => onDeleteFolder(folder.id)}
      onRename={(name) => onRenameFolder(folder.id, name)}
    />
  )

  if (roots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center">
        <FolderOpen size={48} className="text-zinc-700" />
        <p className="text-zinc-500 text-sm">No folders yet</p>
        <button
          onClick={() => onCreateFolder()}
          className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-600 rounded-lg px-3 py-1.5 transition-colors"
        >
          New Folder
        </button>
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={roots.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        <div className="p-2 space-y-0.5">
          {roots.map((folder) => renderFolder(folder, 0))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
