import { useTeamStore, teamColorMap } from '@/store/team'

interface UserDotProps {
  userId: string
  size?: 'sm' | 'md'
  className?: string
}

/**
 * A small colored circle indicating which team member captured a request.
 * Renders nothing when the user_id is empty (local, non-team traffic) or
 * when team mode is not active.
 */
export function UserDot({ userId, size = 'sm', className = '' }: UserDotProps) {
  const members = useTeamStore((s) => s.members)
  const isTeamActive = useTeamStore((s) => s.members.length > 0)

  if (!isTeamActive || !userId) return null

  const member = members.find((m) => m.user_id === userId)
  const color = member ? teamColorMap[member.color] : '215 15% 40%'
  const title = member?.display_name ?? userId

  const sizeClass = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'

  return (
    <span
      className={`inline-block rounded-full flex-shrink-0 ${sizeClass} ${className}`}
      style={{ backgroundColor: `hsl(${color})` }}
      title={title}
    />
  )
}
