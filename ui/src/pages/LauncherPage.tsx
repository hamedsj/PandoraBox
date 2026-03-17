import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface LauncherBridge {
  getRecentProjects: () => Promise<{
    logoSrc: string
    tempPath: string
    recentProjects: string[]
    lastProject: string
    projectNames: Record<string, string>
  }>
  readProjectConfig: (path: string) => Promise<{ name: string; proxyPort: number; mcpPort: number }>
  checkPort: (port: number) => Promise<boolean>
  openFolder: () => Promise<string | null>
  newFolder: () => Promise<string | null>
  launch: (opts: { projectPath: string | null; proxyPort: number; mcpPort: number }) => Promise<{ ok?: true; error?: string }>
  close: () => void
}

declare global {
  interface Window { launcher?: LauncherBridge }
}

interface ProjectEntry {
  path: string
  name: string
  isTemp: boolean
}

const drag:   React.CSSProperties = { WebkitAppRegion: 'drag' }    as React.CSSProperties
const noDrag: React.CSSProperties = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export function LauncherPage() {
  const api = window.launcher

  const [projects,  setProjects]  = useState<ProjectEntry[]>([])
  const [selected,  setSelected]  = useState<string | null>(null)
  const [proxyPort, setProxyPort] = useState('8080')
  const [mcpPort,   setMcpPort]   = useState('9090')
  const [error,     setError]     = useState('')
  const [launching, setLaunching] = useState(false)
  const [initError, setInitError] = useState('')
  const [logoSrc,   setLogoSrc]   = useState('/logo-trimmed.png')

  useEffect(() => {
    if (!api) { setInitError('Launcher bridge not available (window.launcher is undefined)'); return }
    init().catch(e => setInitError(String(e)))
  }, [])

  async function init() {
    const data = await api!.getRecentProjects()

    if (data.logoSrc) setLogoSrc(data.logoSrc)

    const list = buildList(data)
    setProjects(list)

    const def = data.lastProject && data.lastProject !== data.tempPath
      ? data.lastProject
      : data.tempPath

    if (def) await applySelection(def)
  }

  type RecentData = Awaited<ReturnType<LauncherBridge['getRecentProjects']>>

  function buildList(data: RecentData, extraFirst?: ProjectEntry): ProjectEntry[] {
    const seen = new Set<string>()
    const list: ProjectEntry[] = []
    if (extraFirst && !seen.has(extraFirst.path)) {
      list.push(extraFirst); seen.add(extraFirst.path)
    }
    if (!seen.has(data.tempPath)) {
      list.push({ path: data.tempPath, name: 'Temporary Project', isTemp: true })
      seen.add(data.tempPath)
    }
    for (const p of (data.recentProjects || [])) {
      if (seen.has(p)) continue
      seen.add(p)
      list.push({ path: p, name: data.projectNames[p] || p.split('/').pop() || p, isTemp: false })
    }
    return list
  }

  async function applySelection(p: string) {
    setSelected(p)
    setError('')
    try {
      const cfg = await api!.readProjectConfig(p)
      setProxyPort(String(cfg?.proxyPort || 8080))
      setMcpPort(String(cfg?.mcpPort   || 9090))
    } catch {
      setProxyPort('8080')
      setMcpPort('9090')
    }
  }

  async function handleNew() {
    const folder = await api!.newFolder()
    if (!folder) return
    const data = await api!.getRecentProjects()
    const list = buildList(data, { path: folder, name: folder.split('/').pop() || folder, isTemp: false })
    setProjects(list)
    setSelected(folder)
    setProxyPort('8080')
    setMcpPort('9090')
    setError('')
  }

  async function handleOpen() {
    const folder = await api!.openFolder()
    if (!folder) return
    const data = await api!.getRecentProjects()
    const list = buildList(data, {
      path: folder,
      name: data.projectNames[folder] || folder.split('/').pop() || folder,
      isTemp: false,
    })
    setProjects(list)
    await applySelection(folder)
  }

  async function handleLaunch() {
    setError('')
    const pp = parseInt(proxyPort, 10)
    const mp = parseInt(mcpPort,   10)
    if (!pp || pp < 1 || pp > 65535) { setError('Invalid proxy port.'); return }
    if (!mp || mp < 1 || mp > 65535) { setError('Invalid MCP port.');   return }

    setLaunching(true)
    try {
      if (!await api!.checkPort(pp)) { setError(`Proxy port ${pp} is already in use.`); return }
      if (!await api!.checkPort(mp)) { setError(`MCP port ${mp} is already in use.`);   return }
      const result = await api!.launch({ projectPath: selected, proxyPort: pp, mcpPort: mp })
      if (result?.error) setError(result.error)
    } catch (e) {
      setError(String(e))
    } finally {
      setLaunching(false)
    }
  }

  // Hard error — show readable message instead of blank window
  if (initError) {
    return (
      <div className="flex flex-col h-screen bg-background text-foreground items-center justify-center gap-3 p-6">
        <p className="text-sm font-semibold text-red-400">Launcher failed to initialise</p>
        <pre className="text-xs text-muted-foreground bg-muted rounded p-3 max-w-full overflow-auto">{initError}</pre>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden select-none" style={drag}>

      {/* ── Title bar ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 shrink-0 bg-card border-b border-border" style={{ height: 50 }}>
        <div className="flex items-center gap-2.5 bg-primary/20 rounded-lg px-3 py-[7px]">
          <div className="w-[26px] h-[26px] rounded-md bg-background flex items-center justify-center p-[3px] shrink-0">
            <img src={logoSrc} alt="PandoraBox" className="w-full h-full object-contain" />
          </div>
          <span className="text-[13.5px] font-semibold">PandoraBox</span>
        </div>
        <button
          style={noDrag}
          onClick={() => api?.close()}
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/20 hover:text-red-400 transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="1" y1="1" x2="10" y2="10" /><line x1="10" y1="1" x2="1" y2="10" />
          </svg>
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 divide-x divide-border">

        {/* Projects */}
        <div className="flex flex-col gap-3 p-3 flex-1 min-w-0 overflow-hidden">
          <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground shrink-0">
            Select Project
          </p>

          <div className="flex-1 overflow-y-auto space-y-0.5">
            {projects.map(proj => (
              <button
                key={proj.path}
                style={noDrag}
                onClick={() => applySelection(proj.path)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-[7px] rounded-lg text-left transition-all border-[1.5px] text-[12.5px]',
                  selected === proj.path
                    ? 'bg-primary/10 border-primary/40 text-foreground font-medium'
                    : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <div className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0 transition-colors',
                  selected === proj.path ? 'bg-primary' : 'bg-border',
                )} />
                <span className="flex-1 truncate">{proj.name}</span>
                {proj.isTemp && (
                  <span className={cn(
                    'text-[9px] font-bold uppercase tracking-wide px-[5px] py-[2px] rounded shrink-0',
                    selected === proj.path
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground',
                  )}>Temp</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex gap-2 shrink-0">
            <button style={noDrag} onClick={handleNew}
              className="flex-1 text-xs py-[7px] rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground hover:bg-card transition-colors">
              New…
            </button>
            <button style={noDrag} onClick={handleOpen}
              className="flex-1 text-xs py-[7px] rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground hover:bg-card transition-colors">
              Open…
            </button>
          </div>
        </div>

        {/* Ports */}
        <div className="flex flex-col gap-5 p-4 shrink-0" style={{ width: 196 }}>
          <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Ports</p>
          {([
            ['Proxy Port', proxyPort, setProxyPort],
            ['MCP Port',   mcpPort,   setMcpPort],
          ] as const).map(([label, value, setter]) => (
            <div key={label} className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{label}</label>
              <input
                style={noDrag}
                type="number"
                value={value}
                onChange={e => { setter(e.target.value); setError('') }}
                min={1} max={65535}
                className="w-full bg-background border border-border rounded-lg px-3 py-[7px] text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          ))}
        </div>

      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 shrink-0 border-t border-border" style={{ height: 58 }}>
        <p className="text-xs text-red-400 flex-1 truncate mr-4">{error}</p>
        <button
          style={noDrag}
          onClick={handleLaunch}
          disabled={launching || !selected || !api}
          className="px-7 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:opacity-85 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {launching ? 'Starting…' : 'Launch'}
        </button>
      </div>

    </div>
  )
}
