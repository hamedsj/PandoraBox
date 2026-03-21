import { useEffect, useCallback, useRef, useState } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useOrganizerStore } from '@/store/organizer'
import { FolderTree } from '@/components/organizer/FolderTree'
import { FolderDetail } from '@/components/organizer/FolderDetail'
import { FolderForm } from '@/components/organizer/FolderForm'
import { OrganizerRequestPreview } from '@/components/organizer/OrganizerRequestPreview'
import { AddToOrganizerModal } from '@/components/organizer/AddToOrganizerModal'
import type { OrganizerFolder, OrganizerItem, OrganizerColor, OrganizerIcon } from '@/api/client'

export function OrganizerPage() {
  const {
    folders,
    roots,
    itemsByFolder,
    selectedFolderId,
    selectedItemId,
    expandedFolderIds,
    setFolders,
    upsertFolder,
    removeFolder,
    setItemsForFolder,
    upsertItem,
    removeItem,
    setSelectedFolder,
    setSelectedItem,
    toggleExpandFolder,
    expandFolder,
  } = useOrganizerStore()

  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [formInitial, setFormInitial] = useState<Partial<OrganizerFolder> | undefined>()
  const [formParentId, setFormParentId] = useState<number | undefined>()
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null)
  const [addToOrganizerRequestId, setAddToOrganizerRequestId] = useState<number | null>(null)

  // Item note debounce timers
  const itemNoteTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const folderNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingFolderNote = useRef<string>('')

  // Load folders on mount
  useEffect(() => {
    api.organizer.listFolders().then((r) => {
      setFolders(r.flat)
      // Auto-expand root folders
      for (const f of r.flat) {
        if (f.parent_id == null) expandFolder(f.id)
      }
    }).catch(console.error)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load items when folder is selected
  useEffect(() => {
    if (selectedFolderId != null && !itemsByFolder[selectedFolderId]) {
      api.organizer.listItems(selectedFolderId).then((r) => {
        setItemsForFolder(selectedFolderId, r.items)
      }).catch(console.error)
    }
  }, [selectedFolderId]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? null
  const selectedItems = selectedFolderId != null ? (itemsByFolder[selectedFolderId] ?? []) : []
  const selectedItemRequest = selectedItemId != null
    ? selectedItems.find((i) => i.id === selectedItemId)?.request_id ?? null
    : null

  // Item count per folder
  const itemCountByFolder: Record<number, number> = {}
  for (const [fid, items] of Object.entries(itemsByFolder)) {
    itemCountByFolder[Number(fid)] = items.length
  }

  // ── Folder CRUD ────────────────────────────────────────────────────────────

  const openCreateFolder = (parentId?: number) => {
    setFormMode('create')
    setFormInitial(undefined)
    setFormParentId(parentId)
    setEditingFolderId(null)
    setFormOpen(true)
  }

  const openEditFolder = (folder: OrganizerFolder) => {
    setFormMode('edit')
    setFormInitial(folder)
    setFormParentId(undefined)
    setEditingFolderId(folder.id)
    setFormOpen(true)
  }

  const handleFormSave = async (data: { name: string; color: OrganizerColor; icon: OrganizerIcon; note: string }) => {
    if (formMode === 'create') {
      const promise = api.organizer.createFolder({ ...data, parent_id: formParentId ?? null })
      toast.promise(promise, { loading: 'Creating folder…', success: 'Folder created', error: 'Failed to create folder' })
      const f = await promise
      upsertFolder(f)
      setSelectedFolder(f.id)
      expandFolder(f.id)
    } else if (editingFolderId != null) {
      const promise = api.organizer.updateFolder(editingFolderId, data)
      toast.promise(promise, { loading: 'Saving…', success: 'Folder updated', error: 'Failed to update folder' })
      const f = await promise
      upsertFolder(f)
    }
  }

  const handleDeleteFolder = async (id: number) => {
    if (!confirm('Delete this folder and all its contents?')) return
    const promise = api.organizer.deleteFolder(id)
    toast.promise(promise, { loading: 'Deleting…', success: 'Folder deleted', error: 'Failed to delete folder' })
    await promise
    removeFolder(id)
    if (selectedFolderId === id) setSelectedFolder(null)
  }

  const handleRenameFolder = async (id: number, name: string) => {
    const f = await api.organizer.updateFolder(id, { name }).catch(console.error)
    if (f) upsertFolder(f)
  }

  const handleReorderFolders = async (reordered: OrganizerFolder[]) => {
    const updates = reordered.map((f, i) => ({ id: f.id, sort_order: i }))
    // Optimistic update
    setFolders(folders.map((f) => {
      const u = updates.find((x) => x.id === f.id)
      return u ? { ...f, sort_order: u.sort_order } : f
    }))
    await api.organizer.reorderFolders(updates).catch(console.error)
  }

  // ── Folder notes ───────────────────────────────────────────────────────────

  const handleFolderNoteChange = (note: string) => {
    if (!selectedFolder) return
    pendingFolderNote.current = note
    upsertFolder({ ...selectedFolder, note })
  }

  const handleFolderNoteSave = useCallback(() => {
    if (!selectedFolder) return
    if (folderNoteTimer.current) clearTimeout(folderNoteTimer.current)
    folderNoteTimer.current = setTimeout(() => {
      api.organizer.updateFolder(selectedFolder.id, { note: pendingFolderNote.current })
        .then((f) => upsertFolder(f))
        .catch(console.error)
    }, 500)
  }, [selectedFolder]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Item CRUD ──────────────────────────────────────────────────────────────

  const handleRemoveItem = async (itemId: number) => {
    await api.organizer.removeItem(itemId).catch(console.error)
    removeItem(itemId)
  }

  const handleItemNoteChange = (itemId: number, note: string) => {
    const item = selectedItems.find((i) => i.id === itemId)
    if (!item) return
    upsertItem({ ...item, note })
  }

  const handleItemNoteSave = (itemId: number) => {
    const item = useOrganizerStore.getState().itemsByFolder[selectedFolderId!]?.find((i) => i.id === itemId)
    if (!item) return
    if (itemNoteTimers.current[itemId]) clearTimeout(itemNoteTimers.current[itemId])
    itemNoteTimers.current[itemId] = setTimeout(() => {
      api.organizer.updateItem(itemId, { note: item.note })
        .then((updated) => upsertItem(updated))
        .catch(console.error)
    }, 500)
  }

  const handleReorderItems = async (reordered: OrganizerItem[]) => {
    if (selectedFolderId == null) return
    const updates = reordered.map((i, idx) => ({ id: i.id, sort_order: idx }))
    setItemsForFolder(selectedFolderId, reordered)
    await api.organizer.reorderItems(selectedFolderId, updates).catch(console.error)
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalItems = Object.values(itemsByFolder).reduce((acc, items) => acc + items.length, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-950">
      {/* Page header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <FolderOpen size={16} className="text-zinc-400" />
          <span className="text-sm font-semibold text-zinc-100">Organizer</span>
          <span className="text-xs text-zinc-600">{folders.length} folders · {totalItems} requests</span>
        </div>
        <button
          onClick={() => openCreateFolder()}
          className="flex items-center gap-1.5 text-xs bg-zinc-100 text-zinc-900 hover:bg-white rounded-lg px-3 py-1.5 font-medium transition-colors"
        >
          <Plus size={13} />
          New Folder
        </button>
      </div>

      {/* Three-column body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: folder tree */}
        <div className="w-[260px] flex-shrink-0 border-r border-zinc-800 overflow-y-auto">
          <FolderTree
            roots={roots}
            selectedFolderId={selectedFolderId}
            expandedFolderIds={expandedFolderIds}
            itemCountByFolder={itemCountByFolder}
            onSelectFolder={(id) => {
              setSelectedFolder(id)
              setSelectedItem(null)
              expandFolder(id)
            }}
            onToggleExpand={toggleExpandFolder}
            onCreateFolder={openCreateFolder}
            onEditFolder={openEditFolder}
            onDeleteFolder={handleDeleteFolder}
            onRenameFolder={handleRenameFolder}
            onReorderFolders={handleReorderFolders}
          />
        </div>

        {/* Middle: folder detail */}
        <div className="flex-1 min-w-0 border-r border-zinc-800 overflow-hidden flex flex-col">
          <FolderDetail
            folder={selectedFolder}
            items={selectedItems}
            selectedItemId={selectedItemId}
            onSelectItem={(id) => setSelectedItem(id === selectedItemId ? null : id)}
            onEditFolder={() => selectedFolder && openEditFolder(selectedFolder)}
            onAddItem={() => selectedFolder && setAddToOrganizerRequestId(-1)}
            onFolderNoteChange={handleFolderNoteChange}
            onFolderNoteSave={handleFolderNoteSave}
            onItemNoteChange={handleItemNoteChange}
            onItemNoteSave={handleItemNoteSave}
            onRemoveItem={handleRemoveItem}
            onReorderItems={handleReorderItems}
          />
        </div>

        {/* Right: request preview — collapses when no item selected */}
        <div
          className={`flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out ${
            selectedItemRequest != null ? 'w-[420px]' : 'w-0'
          }`}
        >
          {selectedItemRequest != null && (
            <OrganizerRequestPreview requestId={selectedItemRequest} />
          )}
        </div>
      </div>

      {/* Modals */}
      <FolderForm
        open={formOpen}
        mode={formMode}
        initial={formInitial}
        parentId={formParentId}
        onSave={handleFormSave}
        onClose={() => setFormOpen(false)}
      />

      <AddToOrganizerModal
        open={addToOrganizerRequestId != null}
        requestId={addToOrganizerRequestId !== -1 ? addToOrganizerRequestId : null}
        onClose={() => setAddToOrganizerRequestId(null)}
        onCreateFolder={() => openCreateFolder()}
      />
    </div>
  )
}
