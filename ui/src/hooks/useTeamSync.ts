import { useEffect } from 'react'
import { api } from '../api/client'
import { useTeamStore } from '../store/team'

/**
 * Fetches the initial team status on mount and sets up a polling interval to
 * keep the member list and sync status up to date.
 */
export function useTeamSync() {
  const setMembers = useTeamStore((s) => s.setMembers)
  const setSyncStatus = useTeamStore((s) => s.setSyncStatus)
  const setServerMode = useTeamStore((s) => s.setServerMode)
  const setMyUserId = useTeamStore((s) => s.setMyUserId)

  useEffect(() => {
    let cancelled = false

    async function fetchStatus() {
      try {
        const status = await api.team.status()
        if (cancelled) return

        setSyncStatus(status.status)
        if (status.members) setMembers(status.members)

        // Detect server mode by probing the admin endpoint.
        try {
          await api.admin.status()
          if (!cancelled) setServerMode(true)
        } catch {
          // Not in server mode — normal client
        }
      } catch {
        // Team not configured — stay disconnected silently
      }
    }

    // Also try to detect our own user ID via admin status (server mode) or
    // parse it from the first member that matches our connection.
    async function fetchMyId() {
      try {
        const status = await api.team.status()
        if (cancelled || !status) return
        // The server returns members; our own user is identified by the Go backend
        // via the stored appCfg.UserID. We expose it as a dedicated field later.
        // For now, seed the list.
        if (status.members) setMembers(status.members)
      } catch {
        // ignore
      }
    }

    fetchStatus()
    fetchMyId()

    const interval = setInterval(fetchStatus, 10_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [setMembers, setSyncStatus, setServerMode, setMyUserId])
}
