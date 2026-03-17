import { create } from 'zustand'

export interface ConsoleEntry {
  id: string
  source: 'middleware' | 'flow'
  text: string
  timestamp: string
}

interface ConsoleStore {
  entries: ConsoleEntry[]
  isOpen: boolean
  unread: number
  append: (entry: Omit<ConsoleEntry, 'id'>) => void
  clear: () => void
  toggle: () => void
  markRead: () => void
}

const MAX_ENTRIES = 2000

export const useConsoleStore = create<ConsoleStore>((set, get) => ({
  entries: [],
  isOpen: false,
  unread: 0,

  append: (entry) => {
    const { isOpen } = get()
    set((state) => {
      const newEntries = [...state.entries, { ...entry, id: crypto.randomUUID() }]
      const trimmed = newEntries.length > MAX_ENTRIES
        ? newEntries.slice(newEntries.length - MAX_ENTRIES)
        : newEntries
      return {
        entries: trimmed,
        unread: isOpen ? 0 : state.unread + 1,
      }
    })
  },

  clear: () => set({ entries: [], unread: 0 }),

  toggle: () => set((state) => ({
    isOpen: !state.isOpen,
    unread: !state.isOpen ? 0 : state.unread,
  })),

  markRead: () => set({ unread: 0 }),
}))
