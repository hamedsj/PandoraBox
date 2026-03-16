import { useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { InspectorPosition } from '@/store/workspace'

interface RequestWorkspaceLayoutProps {
  position: InspectorPosition
  splitPct: number
  onSplitChange: (value: number) => void
  primary: React.ReactNode
  inspector: React.ReactNode
  inspectorVisible?: boolean
  alwaysShowInspector?: boolean
  sideRange?: [number, number]
  bottomRange?: [number, number]
  className?: string
  primaryClassName?: string
  inspectorClassName?: string
}

export function RequestWorkspaceLayout({
  position,
  splitPct,
  onSplitChange,
  primary,
  inspector,
  inspectorVisible = true,
  alwaysShowInspector = false,
  sideRange = [24, 78],
  bottomRange = [34, 74],
  className,
  primaryClassName,
  inspectorClassName,
}: RequestWorkspaceLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const showInspector = alwaysShowInspector || inspectorVisible
  const isBottom = position === 'bottom'

  const onMouseDown = useCallback(() => {
    if (!showInspector) return
    dragging.current = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = isBottom ? 'row-resize' : 'col-resize'
  }, [isBottom, showInspector])

  const onMouseMove = useCallback((event: React.MouseEvent) => {
    if (!dragging.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const [min, max] = isBottom ? bottomRange : sideRange
    const next = isBottom
      ? ((event.clientY - rect.top) / rect.height) * 100
      : ((event.clientX - rect.left) / rect.width) * 100
    onSplitChange(Math.min(max, Math.max(min, next)))
  }, [bottomRange, isBottom, onSplitChange, sideRange])

  const onMouseUp = useCallback(() => {
    dragging.current = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }, [])

  if (!showInspector) {
    return (
      <div className={cn('flex h-full min-h-0', className)}>
        <div className={cn('min-w-0 flex-1 overflow-hidden', primaryClassName)}>
          {primary}
        </div>
      </div>
    )
  }

  if (isBottom) {
    return (
      <div
        ref={containerRef}
        className={cn('flex h-full min-h-0 flex-col', className)}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <div style={{ height: `${splitPct}%` }} className={cn('min-h-0 overflow-hidden', primaryClassName)}>
          {primary}
        </div>
        <div
          className="h-1.5 cursor-row-resize bg-border transition-colors hover:bg-primary/60"
          onMouseDown={onMouseDown}
        />
        <div style={{ height: `${100 - splitPct}%` }} className={cn('min-h-0 overflow-hidden', inspectorClassName)}>
          {inspector}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full min-h-0', className)}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div style={{ width: `${splitPct}%` }} className={cn('min-w-0 overflow-hidden', primaryClassName)}>
        {primary}
      </div>
      <div
        className="w-1.5 cursor-col-resize bg-border transition-colors hover:bg-primary/60"
        onMouseDown={onMouseDown}
      />
      <div style={{ width: `${100 - splitPct}%` }} className={cn('min-w-0 overflow-hidden', inspectorClassName)}>
        {inspector}
      </div>
    </div>
  )
}
