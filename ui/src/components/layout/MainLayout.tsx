import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useEffect, useRef } from 'react'
import { api } from '@/api/client'
import { useProxyStore } from '@/store/proxy'
import { useFlowsStore } from '@/store/flows'

export function MainLayout() {
  useWebSocket()
  useKeyboardShortcuts()
  const setStatus = useProxyStore((s) => s.setStatus)
  const setProject = useProxyStore((s) => s.setProject)
  const setFlows = useFlowsStore((s) => s.setFlows)
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

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
