import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, FolderPlus, Check } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useOrganizerStore } from '@/store/organizer'
import { OrganizerIconDisplay, FOLDER_COLOR_CLASSES } from './OrganizerIcons'
import type { OrganizerFolder } from '@/api/client'

interface Props {
  open: boolean
  requestId: number | null
  onClose: () => void
  onCreateFolder?: () => void
}

function flattenFolders(roots: OrganizerFolder[], depth = 0): Array<{ folder: OrganizerFolder; depth: number }> {
  const result: Array<{ folder: OrganizerFolder; depth: number }> = []
  for (const f of roots) {
    result.push({ folder: f, depth })
    if (f.children?.length) {
      result.push(...flattenFolders(f.children, depth + 1))
    }
  }
  return result
}

export function AddToOrganizerModal({ open, requestId, onClose, onCreateFolder }: Props) {
  const roots = useOrganizerStore((s) => s.roots)
  const folders = useOrganizerStore((s) => s.folders)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && requestId != null) {
      api.organizer.getRequestFolders(requestId).then((r) => {
        setCheckedIds(new Set(r.folder_ids))
      }).catch(() => setCheckedIds(new Set()))
    }
  }, [open, requestId])

  const toggle = async (folderId: number) => {
    if (requestId == null) return
    const wasChecked = checkedIds.has(folderId)

    const next = new Set(checkedIds)
    if (wasChecked) next.delete(folderId); else next.add(folderId)
    setCheckedIds(next)

    if (wasChecked) {
      // Find item id in store
      const items = useOrganizerStore.getState().itemsByFolder[folderId] ?? []
      const item = items.find((i) => i.request_id === requestId)
      if (item) {
        toast.promise(api.organizer.removeItem(item.id), {
          loading: 'Removing…',
          success: 'Removed from folder',
          error: 'Failed to remove',
        })
      } else {
        // Fallback: just call list then remove
        api.organizer.listItems(folderId).then((r) => {
          const it = r.items.find((i) => i.request_id === requestId)
          if (it) api.organizer.removeItem(it.id)
        })
      }
    } else {
      toast.promise(api.organizer.addItem(folderId, { request_id: requestId }), {
        loading: 'Adding…',
        success: 'Added to folder',
        error: 'Failed to add',
      })
    }
  }

  const flat = flattenFolders(roots)

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50 animate-in fade-in duration-150" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[380px] max-w-[calc(100vw-2rem)] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col max-h-[80vh] animate-in zoom-in-95 fade-in duration-150">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <Dialog.Title className="text-sm font-semibold text-zinc-100">Add to Organizer</Dialog.Title>
            <button onClick={onClose} className="p-1 rounded hover:bg-zinc-700/50 text-zinc-400">
              <X size={14} />
            </button>
          </div>

          <div className="overflow-y-auto flex-1">
            {flat.length === 0 ? (
              <div className="py-10 text-center text-sm text-zinc-500">No folders yet</div>
            ) : (
              <div className="p-2 space-y-0.5">
                {flat.map(({ folder, depth }) => {
                  const colorCls = FOLDER_COLOR_CLASSES[folder.color]
                  const checked = checkedIds.has(folder.id)
                  return (
                    <button
                      key={folder.id}
                      onClick={() => toggle(folder.id)}
                      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-colors text-left ${
                        checked ? `${colorCls.bg} ${colorCls.border} border` : 'hover:bg-zinc-800/60'
                      }`}
                      style={{ paddingLeft: `${8 + depth * 20}px` }}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        checked ? `${colorCls.swatch} border-transparent` : 'border-zinc-600 bg-zinc-800'
                      }`}>
                        {checked && <Check size={10} className="text-white" />}
                      </div>
                      <OrganizerIconDisplay iconName={folder.icon} size={13} className={colorCls.text} />
                      <span className="text-xs text-zinc-200 truncate">{folder.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-zinc-800">
            <button
              onClick={() => { onClose(); onCreateFolder?.() }}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <FolderPlus size={13} />
              Create new folder
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
