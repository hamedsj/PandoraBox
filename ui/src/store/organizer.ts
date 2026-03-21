import { create } from 'zustand'
import type { OrganizerFolder, OrganizerItem } from '@/api/client'

export type { OrganizerFolder, OrganizerItem }

function buildTree(flat: OrganizerFolder[]): OrganizerFolder[] {
  const m = new Map<number, OrganizerFolder>()
  for (const f of flat) {
    m.set(f.id, { ...f, children: [] })
  }
  const roots: OrganizerFolder[] = []
  for (const f of flat) {
    const node = m.get(f.id)!
    if (f.parent_id == null) {
      roots.push(node)
    } else {
      const parent = m.get(f.parent_id)
      if (parent) {
        parent.children = parent.children ?? []
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    }
  }
  const sortLevel = (arr: OrganizerFolder[]) => {
    arr.sort((a, b) => a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.id - b.id)
    for (const f of arr) {
      if (f.children?.length) sortLevel(f.children)
    }
  }
  sortLevel(roots)
  return roots
}

interface OrganizerStore {
  folders: OrganizerFolder[]
  roots: OrganizerFolder[]
  itemsByFolder: Record<number, OrganizerItem[]>
  selectedFolderId: number | null
  selectedItemId: number | null
  expandedFolderIds: Set<number>

  setFolders: (flat: OrganizerFolder[]) => void
  upsertFolder: (f: OrganizerFolder) => void
  removeFolder: (id: number) => void
  setItemsForFolder: (folderId: number, items: OrganizerItem[]) => void
  upsertItem: (item: OrganizerItem) => void
  removeItem: (id: number) => void
  setSelectedFolder: (id: number | null) => void
  setSelectedItem: (id: number | null) => void
  toggleExpandFolder: (id: number) => void
  expandFolder: (id: number) => void
}

export const useOrganizerStore = create<OrganizerStore>((set, get) => ({
  folders: [],
  roots: [],
  itemsByFolder: {},
  selectedFolderId: null,
  selectedItemId: null,
  expandedFolderIds: new Set(),

  setFolders: (flat) => {
    set({ folders: flat, roots: buildTree(flat) })
  },

  upsertFolder: (f) => {
    const folders = get().folders
    const idx = folders.findIndex((x) => x.id === f.id)
    const next = idx >= 0 ? folders.map((x) => (x.id === f.id ? f : x)) : [f, ...folders]
    set({ folders: next, roots: buildTree(next) })
  },

  removeFolder: (id) => {
    // Collect all descendant IDs recursively
    const all = get().folders
    const toRemove = new Set<number>()
    const collect = (fid: number) => {
      toRemove.add(fid)
      for (const f of all) {
        if (f.parent_id === fid) collect(f.id)
      }
    }
    collect(id)
    const next = all.filter((f) => !toRemove.has(f.id))
    const itemsByFolder = { ...get().itemsByFolder }
    for (const fid of toRemove) delete itemsByFolder[fid]
    set({
      folders: next,
      roots: buildTree(next),
      itemsByFolder,
      selectedFolderId: toRemove.has(get().selectedFolderId ?? -1) ? null : get().selectedFolderId,
    })
  },

  setItemsForFolder: (folderId, items) => {
    set((s) => ({ itemsByFolder: { ...s.itemsByFolder, [folderId]: items } }))
  },

  upsertItem: (item) => {
    const existing = get().itemsByFolder[item.folder_id] ?? []
    const idx = existing.findIndex((x) => x.id === item.id)
    const next = idx >= 0 ? existing.map((x) => (x.id === item.id ? item : x)) : [...existing, item]
    set((s) => ({ itemsByFolder: { ...s.itemsByFolder, [item.folder_id]: next } }))
  },

  removeItem: (id) => {
    const itemsByFolder = { ...get().itemsByFolder }
    for (const fid of Object.keys(itemsByFolder)) {
      const key = Number(fid)
      itemsByFolder[key] = itemsByFolder[key].filter((x) => x.id !== id)
    }
    set({
      itemsByFolder,
      selectedItemId: get().selectedItemId === id ? null : get().selectedItemId,
    })
  },

  setSelectedFolder: (id) => set({ selectedFolderId: id }),
  setSelectedItem: (id) => set({ selectedItemId: id }),

  toggleExpandFolder: (id) => {
    const s = new Set(get().expandedFolderIds)
    if (s.has(id)) s.delete(id); else s.add(id)
    set({ expandedFolderIds: s })
  },

  expandFolder: (id) => {
    const s = new Set(get().expandedFolderIds)
    s.add(id)
    set({ expandedFolderIds: s })
  },
}))
