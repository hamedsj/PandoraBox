import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ReplayStore {
  autoContentLength: boolean
  setAutoContentLength: (enabled: boolean) => void
}

export const useReplayStore = create<ReplayStore>()(
  persist(
    (set) => ({
      autoContentLength: true,
      setAutoContentLength: (autoContentLength) => set({ autoContentLength }),
    }),
    { name: 'pandora-replay' }
  )
)
