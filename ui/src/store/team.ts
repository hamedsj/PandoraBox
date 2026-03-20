import { create } from 'zustand'
import type { TeamMember } from '../api/client'

export type SyncStatus = 'connected' | 'connecting' | 'disconnected'

// The 10 accent colors mapped to Tailwind-compatible HSL values (same as theme store).
export const teamColorMap: Record<string, string> = {
  teal:   '174 72% 46%',
  blue:   '214 84% 56%',
  purple: '262 83% 64%',
  indigo: '238 84% 67%',
  pink:   '330 81% 60%',
  red:    '0 72% 51%',
  orange: '25 95% 53%',
  yellow: '43 96% 56%',
  green:  '142 71% 45%',
  cyan:   '188 94% 52%',
}

export function memberInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/)
  if (parts.length === 0 || parts[0] === '') return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface TeamStore {
  // Connection
  members: TeamMember[]
  syncStatus: SyncStatus
  isServerMode: boolean

  // UI state — which user's traffic is shown in history
  activeUserTab: string // 'all' | 'mine' | <user_id>

  // Current user identity (populated from /api/team/status on startup)
  myUserId: string

  // Actions
  setMembers: (members: TeamMember[]) => void
  upsertMember: (member: TeamMember) => void
  removeMember: (userId: string) => void
  setSyncStatus: (status: SyncStatus) => void
  setServerMode: (isServer: boolean) => void
  setActiveUserTab: (tab: string) => void
  setMyUserId: (id: string) => void
}

export const useTeamStore = create<TeamStore>()((set) => ({
  members: [],
  syncStatus: 'disconnected',
  isServerMode: false,
  activeUserTab: 'all',
  myUserId: '',

  setMembers: (members) => set({ members }),

  upsertMember: (member) =>
    set((state) => {
      const idx = state.members.findIndex((m) => m.user_id === member.user_id)
      if (idx === -1) return { members: [...state.members, member] }
      const updated = [...state.members]
      updated[idx] = member
      return { members: updated }
    }),

  removeMember: (userId) =>
    set((state) => ({
      members: state.members.map((m) =>
        m.user_id === userId ? { ...m, online: false } : m
      ),
    })),

  setSyncStatus: (status) => set({ syncStatus: status }),
  setServerMode: (isServer) => set({ isServerMode: isServer }),
  setActiveUserTab: (tab) => set({ activeUserTab: tab }),
  setMyUserId: (id) => set({ myUserId: id }),
}))

// Helper: returns the HSL color string for a member's accent color.
export function memberColor(member: TeamMember): string {
  return teamColorMap[member.color] ?? teamColorMap['teal']
}
