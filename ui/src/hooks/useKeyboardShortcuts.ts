import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createShortcutEvent, isEditableTarget, matchesShortcut, allowsInEditable } from '@/lib/shortcuts'
import { useProxyStore } from '@/store/proxy'
import { useShortcutStore } from '@/store/shortcuts'
import { type ShortcutActionId } from '@/shortcuts/actions'

const routeActions: Partial<Record<ShortcutActionId, string>> = {
  'app.gotoIntercept': '/intercept',
  'app.gotoHistory': '/history',
  'app.gotoScope': '/scope',
  'app.gotoSitemap': '/sitemap',
  'app.gotoReplay': '/replay',
  'app.gotoSettings': '/settings',
}

function dispatchPageAction(actionId: ShortcutActionId) {
  window.dispatchEvent(createShortcutEvent(actionId))
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()
  const enabled = useShortcutStore((state) => state.enabled)
  const bindings = useShortcutStore((state) => state.bindings)
  const setSelectedRequestId = useProxyStore((state) => state.setSelectedRequestId)

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent) {
      const actionId = (Object.entries(bindings) as [ShortcutActionId, string][])
        .find(([, binding]) => binding && matchesShortcut(event, binding))?.[0]

      if (!actionId) return

      if (isEditableTarget(event.target) && !allowsInEditable(actionId)) return

      let handled = true

      if (routeActions[actionId]) {
        navigate(routeActions[actionId]!)
      } else if (actionId === 'common.openFilters') {
        if (location.pathname === '/history' || location.pathname === '/sitemap') {
          dispatchPageAction(actionId)
        } else {
          handled = false
        }
      } else if (actionId === 'common.closeCurrent') {
        dispatchPageAction(actionId)
        setSelectedRequestId(null)
      } else if (actionId === 'common.escape') {
        dispatchPageAction(actionId)
        setSelectedRequestId(null)
      } else if (actionId === 'common.sendSelectedToReplay') {
        const selectedId = useProxyStore.getState().selectedRequestId
        const selectedRequest = useProxyStore.getState().requests.find((request) => request.id === selectedId)
        if (selectedRequest) {
          useProxyStore.getState().addToReplay(selectedRequest)
          navigate('/replay')
        } else {
          handled = false
        }
      } else {
        dispatchPageAction(actionId)
      }

      if (handled) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [bindings, enabled, location.pathname, navigate, setSelectedRequestId])
}
