import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultShortcutBindings, type ShortcutActionId } from '@/shortcuts/actions'

interface ShortcutStore {
  enabled: boolean
  bindings: Record<ShortcutActionId, string>
  setEnabled: (enabled: boolean) => void
  setBinding: (actionId: ShortcutActionId, binding: string) => void
  resetBindings: () => void
}

export const useShortcutStore = create<ShortcutStore>()(
  persist(
    (set) => ({
      enabled: true,
      bindings: defaultShortcutBindings,
      setEnabled: (enabled) => set({ enabled }),
      setBinding: (actionId, binding) =>
        set((state) => ({
          bindings: {
            ...state.bindings,
            [actionId]: binding,
          },
        })),
      resetBindings: () => set({ bindings: defaultShortcutBindings }),
    }),
    { name: 'pandora-shortcuts' }
  )
)
