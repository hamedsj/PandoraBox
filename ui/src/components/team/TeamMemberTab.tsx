import { memberInitials, memberColor } from '@/store/team'
import type { TeamMember } from '@/api/client'

interface TeamMemberTabProps {
  member: TeamMember
  active: boolean
  onClick: () => void
}

/**
 * A history tab that represents a single team member. Shows their initials
 * in their accent color plus their display name.
 */
export function TeamMemberTab({ member, active, onClick }: TeamMemberTabProps) {
  const color = memberColor(member)
  const initials = memberInitials(member.display_name || member.user_id)

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
      ].join(' ')}
      title={member.display_name || member.user_id}
    >
      {/* Avatar circle */}
      <span
        className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white flex-shrink-0"
        style={{ backgroundColor: `hsl(${color})` }}
      >
        {initials}
      </span>
      <span className="max-w-[80px] truncate">{member.display_name || member.user_id}</span>
      {/* Online indicator */}
      <span
        className={[
          'h-1.5 w-1.5 rounded-full flex-shrink-0',
          member.online ? 'bg-green-400' : 'bg-muted-foreground/40',
        ].join(' ')}
      />
    </button>
  )
}
