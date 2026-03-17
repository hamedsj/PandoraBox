import type { ShortcutActionId } from '@/shortcuts/actions'

const modifierKeys = new Set(['Meta', 'Control', 'Shift', 'Alt'])

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

function normalizeBaseKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key === 'Esc') return 'Escape'
  if (key.length === 1) return key.toUpperCase()
  return key
}

export function eventToShortcut(event: KeyboardEvent): string | null {
  if (modifierKeys.has(event.key)) return null

  const parts: string[] = []
  const isMac = isMacPlatform()

  if ((isMac && event.metaKey) || (!isMac && event.ctrlKey)) parts.push('Mod')
  if (isMac && event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  const key = normalizeBaseKey(event.key)
  if (!key) return null

  parts.push(key)
  return parts.join('+')
}

export function matchesShortcut(event: KeyboardEvent, binding: string): boolean {
  const normalized = eventToShortcut(event)
  return normalized === binding
}

export function formatShortcut(binding: string): string {
  const isMac = isMacPlatform()
  return binding
    .split('+')
    .map((part) => {
      if (part === 'Mod') return isMac ? 'Cmd' : 'Ctrl'
      if (part === 'Alt') return isMac ? 'Opt' : 'Alt'
      return part
    })
    .join(isMac ? ' ' : '+')
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('[data-shortcut-capture="true"]')) return true
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return true
  if (target.closest('.monaco-editor')) return true
  return false
}

export function allowsInEditable(actionId: ShortcutActionId): boolean {
  return (
    actionId === 'common.closeCurrent' ||
    actionId === 'common.sendSelectedToReplay' ||
    actionId === 'common.escape' ||
    actionId === 'intercept.applyAndForward' ||
    actionId === 'replay.send'
  )
}

export function createShortcutEvent(actionId: ShortcutActionId): CustomEvent<{ actionId: ShortcutActionId }> {
  return new CustomEvent('pandora:shortcut-action', {
    detail: { actionId },
  })
}

export function subscribeShortcutAction(
  handler: (actionId: ShortcutActionId) => void
): () => void {
  function listener(event: Event) {
    const shortcutEvent = event as CustomEvent<{ actionId: ShortcutActionId }>
    handler(shortcutEvent.detail.actionId)
  }

  window.addEventListener('pandora:shortcut-action', listener)
  return () => window.removeEventListener('pandora:shortcut-action', listener)
}
