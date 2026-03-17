import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ConsolePanel } from '@/components/console/ConsolePanel'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useEffect, useRef } from 'react'
import { api } from '@/api/client'
import { useProxyStore } from '@/store/proxy'
import { useFlowsStore } from '@/store/flows'
import { useConsoleStore } from '@/store/console'

export function MainLayout() {
  useWebSocket()
  useKeyboardShortcuts()
  const setStatus = useProxyStore((s) => s.setStatus)
  const setProject = useProxyStore((s) => s.setProject)
  const setFlows = useFlowsStore((s) => s.setFlows)
  const toggleConsole = useConsoleStore((s) => s.toggle)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filtersRef = useRef(useProxyStore.getState().filters)

  // Load project on mount
  useEffect(() => {
    api.project.get().then((p) => {
      setProject(p)
      setFlows(p.flows ?? [])
    }).catch(console.error)
  }, [setProject, setFlows])

  // Poll proxy status
  useEffect(() => {
    api.proxy.status().then(setStatus).catch(console.error)
    const t = setInterval(() => {
      api.proxy.status().then(setStatus).catch(console.error)
    }, 5000)
    return () => clearInterval(t)
  }, [setStatus])

  // Debounce filter changes → save to project.json
  useEffect(() => {
    const unsub = useProxyStore.subscribe((state) => {
      const f = state.filters
      if (f === filtersRef.current) return
      filtersRef.current = f
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        api.project.update({ filters: f }).catch(console.error)
      }, 500)
    })
    return () => {
      unsub()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Backtick toggles console
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === '`' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
        toggleConsole()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleConsole])

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <ConsolePanel />
    </div>
  )
}
