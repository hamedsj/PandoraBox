import { useState, useRef, useEffect } from 'react'
import { FolderOpen, FolderPlus, Save, ChevronDown, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/api/client'
import { useProxyStore } from '@/store/proxy'

declare global {
  interface Window {
    electron?: {
      openFolder: () => Promise<string | null>
      newFolder: () => Promise<string | null>
    }
  }
}

export function ProjectSwitcher() {
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<{ path: string; name: string; exists: boolean }[]>([])
  const [pathInput, setPathInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const project = useProxyStore((s) => s.project)
  const setProject = useProxyStore((s) => s.setProject)
  const setRequests = useProxyStore((s) => s.setRequests)

  useEffect(() => {
    if (open) {
      api.project.recent().then(setRecent).catch(console.error)
    }
  }, [open])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function switchToProject(p: typeof project) {
    if (!p) return
    setProject(p)
    setRequests([])
    setOpen(false)
  }

  async function handleOpenFolder() {
    let folderPath: string | null = null
    if (window.electron) {
      folderPath = await window.electron.openFolder()
    } else {
      folderPath = pathInput.trim() || null
    }
    if (!folderPath) return
    setLoading(true)
    try {
      const p = await api.project.open(folderPath)
      switchToProject(p)
    } catch (e) {
      console.error('Failed to open project:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleNewFolder() {
    let folderPath: string | null = null
    if (window.electron) {
      folderPath = await window.electron.newFolder()
    } else {
      folderPath = pathInput.trim() || null
    }
    if (!folderPath) return
    const name = nameInput.trim() || 'New Project'
    setLoading(true)
    try {
      const p = await api.project.new(folderPath, name)
      switchToProject(p)
    } catch (e) {
      console.error('Failed to create project:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveAs() {
    let folderPath: string | null = null
    if (window.electron) {
      folderPath = await window.electron.newFolder()
    } else {
      folderPath = pathInput.trim() || null
    }
    if (!folderPath) return
    setLoading(true)
    try {
      const p = await api.project.saveAs(folderPath)
      switchToProject(p)
    } catch (e) {
      console.error('Failed to save project:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleOpenRecent(path: string) {
    setLoading(true)
    try {
      const p = await api.project.open(path)
      switchToProject(p)
    } catch (e) {
      console.error('Failed to open recent project:', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={ref} className="relative px-3 mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all',
          'border border-border hover:border-primary/50',
          'bg-muted/50 hover:bg-muted text-foreground',
        )}
      >
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-xs">
              {project?.name ?? 'Loading...'}
            </span>
            {project?.is_temp && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold shrink-0">
                TEMP
              </span>
            )}
          </div>
          {project?.path && (
            <div className="text-[10px] text-muted-foreground truncate mt-0.5">
              {project.path}
            </div>
          )}
        </div>
        <ChevronDown size={14} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
          {/* Actions */}
          <div className="p-2 space-y-1">
            <button
              onClick={handleOpenFolder}
              disabled={loading}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors text-left"
            >
              <FolderOpen size={15} className="text-primary shrink-0" />
              <span>Open Project…</span>
            </button>
            <button
              onClick={handleNewFolder}
              disabled={loading}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors text-left"
            >
              <FolderPlus size={15} className="text-primary shrink-0" />
              <span>New Project…</span>
            </button>
            {project?.is_temp && (
              <button
                onClick={handleSaveAs}
                disabled={loading}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors text-left text-amber-400"
              >
                <Save size={15} className="shrink-0" />
                <span>Save Temp As…</span>
              </button>
            )}
          </div>

          {/* Web-mode fallback inputs (only shown if no Electron) */}
          {!window.electron && (
            <div className="px-3 pb-2 space-y-1 border-t border-border pt-2">
              <input
                type="text"
                placeholder="Folder path…"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
              <input
                type="text"
                placeholder="Project name (for New)"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
          )}

          {/* Recent Projects */}
          {recent.length > 0 && (
            <>
              <div className="px-3 py-1.5 border-t border-border">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                  <Clock size={10} />
                  Recent
                </div>
              </div>
              <div className="pb-1">
                {recent.map((r) => (
                  <button
                    key={r.path}
                    onClick={() => r.exists && handleOpenRecent(r.path)}
                    disabled={!r.exists || loading}
                    className={cn(
                      'w-full flex flex-col px-3 py-2 text-left text-xs transition-colors',
                      r.exists
                        ? 'hover:bg-muted cursor-pointer'
                        : 'opacity-40 cursor-not-allowed',
                    )}
                  >
                    <span className="font-medium truncate">{r.name}</span>
                    <span className="text-muted-foreground truncate">{r.path}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
