import { NavLink } from 'react-router-dom'
import { Globe, Shield, RotateCcw, Settings, Target, Network, Replace, GitBranch, Terminal, Wifi, WifiOff, Loader2, FolderOpen, Crosshair, RadioTower, Binary } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useProxyStore } from '@/store/proxy'
import { useReplayQueueStore } from '@/store/replayQueue'
import { useConsoleStore } from '@/store/console'
import { useTeamStore } from '@/store/team'
import { useIntruderStore } from '@/store/intruder'
import { useCollaboratorStore } from '@/store/collaborator'
import { TeamPresence } from '@/components/team/TeamPresence'
import { ProjectSwitcher } from './ProjectSwitcher'
import { useEffect, useState } from 'react'

const navItems = [
  { to: '/intercept', label: 'Intercept', icon: Shield },
  { to: '/history', label: 'History', icon: Globe },
  { to: '/scope', label: 'Scope', icon: Target },
  { to: '/match-replace', label: 'Match & Replace', icon: Replace },
  { to: '/sitemap', label: 'SiteMap', icon: Network },
  { to: '/replay', label: 'Replay', icon: RotateCcw },
  { to: '/converter', label: 'Converter', icon: Binary },
  { to: '/intruder', label: 'Intruder', icon: Crosshair },
  { to: '/collaborator', label: 'Collaborator', icon: RadioTower },
  { to: '/flows', label: 'Flows', icon: GitBranch },
  { to: '/organizer', label: 'Organizer', icon: FolderOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const status = useProxyStore((s) => s.status)
  const replayAttentionTick = useReplayQueueStore((s) => s.attentionTick)
  const { toggle: toggleConsole, unread, isOpen: consoleOpen } = useConsoleStore()
  const syncStatus = useTeamStore((s) => s.syncStatus)
  const intruderAttentionTick = useIntruderStore((s) => s.intruderAttentionTick)
  const collaboratorAttentionTick = useCollaboratorStore((s) => s.collaboratorAttentionTick)
  const [blinkReplay, setBlinkReplay] = useState(false)
  const [blinkIntruder, setBlinkIntruder] = useState(false)
  const [blinkCollaborator, setBlinkCollaborator] = useState(false)

  useEffect(() => {
    if (replayAttentionTick === 0) return
    setBlinkReplay(false)
    const frame = window.requestAnimationFrame(() => setBlinkReplay(true))
    const timeout = window.setTimeout(() => setBlinkReplay(false), 950)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
  }, [replayAttentionTick])

  useEffect(() => {
    if (intruderAttentionTick === 0) return
    setBlinkIntruder(false)
    const frame = window.requestAnimationFrame(() => setBlinkIntruder(true))
    const timeout = window.setTimeout(() => setBlinkIntruder(false), 950)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
  }, [intruderAttentionTick])

  useEffect(() => {
    if (collaboratorAttentionTick === 0) return
    setBlinkCollaborator(false)
    const frame = window.requestAnimationFrame(() => setBlinkCollaborator(true))
    const timeout = window.setTimeout(() => setBlinkCollaborator(false), 950)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
  }, [collaboratorAttentionTick])

  return (
    <aside className="w-52 flex flex-col py-2 border-r border-border bg-card gap-1">
      {/* Logo */}
      <div className="px-3 mb-1.5">
        <div className="flex items-center gap-2.5 bg-primary/20 rounded-lg p-2.5">
          <div className="w-6 h-6 rounded-md bg-[#101318] flex items-center justify-center shrink-0 p-1">
            <img src="/logo-trimmed.png" alt="PandoraBox" className="w-full h-full object-contain" />
          </div>
          <span className="text-foreground font-semibold text-[13px]">PandoraBox</span>
        </div>
      </div>

      {/* Project Switcher */}
      <ProjectSwitcher />

      {/* Navigation */}
      <nav className="flex-1 px-2.5 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all text-[13px] leading-none',
                to === '/replay' && blinkReplay && 'replay-attention',
                to === '/intruder' && blinkIntruder && 'replay-attention',
                to === '/collaborator' && blinkCollaborator && 'replay-attention',
                isActive
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )
            }
          >
            <Icon size={16} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Team Presence — avatar bubbles of online teammates */}
      <TeamPresence />

      {/* Bottom section */}
      <div className="px-2.5 flex flex-col gap-1.5">
        {/* Console Toggle */}
        <button
          onClick={toggleConsole}
          title="Console (`)"
          className={cn(
            'relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all text-[13px] leading-none',
            consoleOpen
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        >
          <Terminal size={16} />
          <span>Console</span>
          {unread > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>

        {/* Status row: proxy + team sync */}
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <div className="flex items-center gap-2">
            <div
              title={status?.running ? 'Proxy running' : 'Proxy stopped'}
              className={cn(
                'w-2 h-2 rounded-full',
                status?.running ? 'bg-emerald-400' : 'bg-red-400'
              )}
            />
            <span className="text-[11px] text-muted-foreground">
              {status?.running ? 'Proxy Active' : 'Proxy Stopped'}
            </span>
          </div>
          {/* Team sync icon — only shown when team client is configured */}
          {syncStatus !== 'disconnected' && (
            <span
              title={
                syncStatus === 'connected' ? 'Team: connected' :
                syncStatus === 'connecting' ? 'Team: connecting…' : 'Team: disconnected'
              }
              className={cn(
                'text-[11px]',
                syncStatus === 'connected' ? 'text-emerald-400' :
                syncStatus === 'connecting' ? 'text-amber-400' : 'text-muted-foreground'
              )}
            >
              {syncStatus === 'connected' && <Wifi size={13} />}
              {syncStatus === 'connecting' && <Loader2 size={13} className="animate-spin" />}
            </span>
          )}
        </div>
      </div>
    </aside>
  )
}
