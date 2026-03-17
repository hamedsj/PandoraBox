import { NavLink } from 'react-router-dom'
import { Globe, Shield, RotateCcw, Settings, Sun, Moon, Target, Network, Replace, GitBranch, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useProxyStore } from '@/store/proxy'
import { useThemeStore } from '@/store/theme'
import { useConsoleStore } from '@/store/console'
import { ProjectSwitcher } from './ProjectSwitcher'
import { useEffect, useState } from 'react'

const navItems = [
  { to: '/intercept', label: 'Intercept', icon: Shield },
  { to: '/history', label: 'History', icon: Globe },
  { to: '/scope', label: 'Scope', icon: Target },
  { to: '/match-replace', label: 'Match & Replace', icon: Replace },
  { to: '/sitemap', label: 'SiteMap', icon: Network },
  { to: '/replay', label: 'Replay', icon: RotateCcw },
  { to: '/flows', label: 'Flows', icon: GitBranch },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const status = useProxyStore((s) => s.status)
  const replayAttentionTick = useProxyStore((s) => s.replayAttentionTick)
  const { mode, setMode } = useThemeStore()
  const { toggle: toggleConsole, unread, isOpen: consoleOpen } = useConsoleStore()
  const [blinkReplay, setBlinkReplay] = useState(false)

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

  return (
    <aside className="w-56 flex flex-col py-3 border-r border-border bg-card gap-1">
      {/* Logo */}
      <div className="px-4 mb-2">
        <div className="flex items-center gap-3 bg-primary/20 rounded-lg p-3">
          <span className="text-primary text-lg font-bold font-mono">P</span>
          <span className="text-foreground font-semibold">PandoraBox</span>
        </div>
      </div>

      {/* Project Switcher */}
      <ProjectSwitcher />

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm',
                to === '/replay' && blinkReplay && 'replay-attention',
                isActive
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )
            }
          >
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Bottom section */}
      <div className="px-3 flex flex-col gap-2">
        {/* Theme Toggle */}
        <button
          onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
          title={mode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          {mode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          <span>{mode === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </button>

        {/* Console Toggle */}
        <button
          onClick={toggleConsole}
          title="Console (`)"
          className={cn(
            'relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm',
            consoleOpen
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        >
          <Terminal size={18} />
          <span>Console</span>
          {unread > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>

        {/* Proxy Status Indicator */}
        <div className="flex items-center gap-3 px-3 py-2">
          <div
            title={status?.running ? 'Proxy running' : 'Proxy stopped'}
            className={cn(
              'w-2 h-2 rounded-full',
              status?.running ? 'bg-emerald-400' : 'bg-red-400'
            )}
          />
          <span className="text-xs text-muted-foreground">
            {status?.running ? 'Proxy Active' : 'Proxy Stopped'}
          </span>
        </div>
      </div>
    </aside>
  )
}
