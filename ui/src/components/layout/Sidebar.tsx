import { NavLink } from 'react-router-dom'
import { Globe, Shield, RotateCcw, Settings, Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useProxyStore } from '@/store/proxy'
import { useThemeStore } from '@/store/theme'

const navItems = [
  { to: '/history', label: 'History', icon: Globe },
  { to: '/intercept', label: 'Intercept', icon: Shield },
  { to: '/replay', label: 'Replay', icon: RotateCcw },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const status = useProxyStore((s) => s.status)
  const { mode, setMode } = useThemeStore()

  return (
    <aside className="w-14 flex flex-col items-center py-3 border-r border-border bg-card gap-1">
      {/* Logo */}
      <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center mb-3">
        <span className="text-primary text-xs font-bold font-mono">P</span>
      </div>

      {navItems.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          title={label}
          className={({ isActive }) =>
            cn(
              'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
              isActive
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )
          }
        >
          <Icon size={18} />
        </NavLink>
      ))}

      <div className="mt-auto flex flex-col gap-2">
        {/* Theme Toggle */}
        <button
          onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
          title={mode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          {mode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Proxy Status Indicator */}
        <div
          title={status?.running ? 'Proxy running' : 'Proxy stopped'}
          className={cn(
            'w-2 h-2 rounded-full mx-auto',
            status?.running ? 'bg-emerald-400' : 'bg-red-400'
          )}
        />
      </div>
    </aside>
  )
}
