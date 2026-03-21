import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Module-level registry — ensures only one context menu is open at a time across the whole app
const registry = new Set<() => void>()

export function useContextMenu() {
  const [open, setOpen] = useState(false)
  const [rawPos, setRawPos] = useState({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  // Register this instance so others can close it
  useEffect(() => {
    registry.add(close)
    return () => { registry.delete(close) }
  }, [close])

  const openMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Close every other open menu before opening this one
    registry.forEach((cb) => { if (cb !== close) cb() })
    setRawPos({ x: e.clientX, y: e.clientY })
    setOpen(true)
  }, [close])

  // Close on outside click, right-click elsewhere, or Escape
  useEffect(() => {
    if (!open) return
    const dismiss = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', dismiss)
    document.addEventListener('contextmenu', dismiss)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', dismiss)
      document.removeEventListener('contextmenu', dismiss)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Adjust position so the menu stays fully within the viewport — runs before paint
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return
    const el = menuRef.current
    el.style.visibility = 'hidden'
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 8
    const x = rawPos.x + width + gap > vw ? rawPos.x - width : rawPos.x
    const y = rawPos.y + height + gap > vh ? rawPos.y - height : rawPos.y
    el.style.left = `${Math.max(gap, x)}px`
    el.style.top = `${Math.max(gap, y)}px`
    el.style.visibility = 'visible'
  }, [open, rawPos])

  return { open, openMenu, close, menuRef }
}
