import { useTeamStore, memberColor, memberInitials } from '@/store/team'

const MAX_VISIBLE = 5

/**
 * A compact row of avatar bubbles showing online team members.
 * Rendered in the Sidebar bottom section. Clicking a bubble sets the history
 * user-filter tab to that member.
 */
export function TeamPresence() {
  const members = useTeamStore((s) => s.members)
  const setActiveUserTab = useTeamStore((s) => s.setActiveUserTab)
  const activeUserTab = useTeamStore((s) => s.activeUserTab)

  const online = members.filter((m) => m.online)
  if (online.length === 0) return null

  const visible = online.slice(0, MAX_VISIBLE)
  const overflow = online.length - MAX_VISIBLE

  return (
    <div className="px-3 py-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        {visible.map((member) => {
          const color = memberColor(member)
          const initials = memberInitials(member.display_name || member.user_id)
          const isActive = activeUserTab === member.user_id
          return (
            <button
              key={member.user_id}
              type="button"
              title={member.display_name || member.user_id}
              onClick={() => setActiveUserTab(isActive ? 'all' : member.user_id)}
              className="relative flex-shrink-0 transition-transform hover:scale-110 focus:outline-none"
            >
              {/* Avatar circle */}
              <span
                className={[
                  'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white',
                  isActive ? 'ring-2 ring-primary ring-offset-1 ring-offset-card' : '',
                ].join(' ')}
                style={{ backgroundColor: `hsl(${color})` }}
              >
                {initials}
              </span>
              {/* Online pulse dot */}
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-green-400" />
            </button>
          )
        })}
        {overflow > 0 && (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
            +{overflow}
          </span>
        )}
      </div>
    </div>
  )
}
