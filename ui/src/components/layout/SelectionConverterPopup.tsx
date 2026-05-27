import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Copy, Replace, X } from 'lucide-react'
import { api } from '@/api/client'
import type { ConverterAlgorithm } from '@/api/client'
import { useProxyStore } from '@/store/proxy'
import { useConverterStore } from '@/store/converter'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'

type Anchor = { x: number; y: number }
type PopupState = { text: string; anchor: Anchor; canReplace: boolean }
type ConverterSelectionDetail = {
  text: string
  x: number
  y: number
  canReplace?: boolean
  replaceSelection?: (nextText: string) => void
}

const POPUP_WIDTH = 360
const SHOW_DELAY = 140 // wait for the selection to settle before showing
const PREVIEW_DELAY = 220 // debounce live preview
const EDGE_PAD = 12

/**
 * Floating quick-convert popup. It is intentionally driven ONLY by selections
 * inside the app's code/body editors (the `pandora:converter-selection` event
 * emitted by CodeViewer). It deliberately does NOT listen to global document
 * selections, so it never appears over unrelated UI chrome. Non-editor text
 * (e.g. headers) still reaches the converter via the right-click menu.
 */
export function SelectionConverterPopup() {
  const navigate = useNavigate()
  const project = useProxyStore((s) => s.project)
  const sendToConverter = useConverterStore((s) => s.sendToConverter)

  const [popup, setPopup] = useState<PopupState | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 })
  const [mode, setMode] = useState<'algorithm' | 'stack'>('algorithm')
  const [algorithm, setAlgorithm] = useState('base64_decode')
  const [stackId, setStackId] = useState('')
  const [algorithms, setAlgorithms] = useState<ConverterAlgorithm[]>([])
  const [preview, setPreview] = useState('')
  const [previewError, setPreviewError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const popupRef = useRef<HTMLDivElement | null>(null)
  const popupOpenRef = useRef(false)
  const replaceSelectionRef = useRef<((nextText: string) => void) | null>(null)
  const showTimerRef = useRef<number | undefined>(undefined)
  const pendingDetailRef = useRef<ConverterSelectionDetail | null>(null)

  const stacks = project?.converter?.stacks ?? []
  const hasStacks = stacks.length > 0

  useEffect(() => {
    api.converter.get().then((r) => {
      const algs = r.algorithms ?? []
      setAlgorithms(algs)
      setAlgorithm((cur) => (algs.some((a) => a.id === cur) ? cur : algs[0]?.id ?? cur))
    }).catch(console.error)
  }, [])

  useEffect(() => {
    if (!hasStacks) {
      setStackId('')
      setMode((m) => (m === 'stack' ? 'algorithm' : m))
      return
    }
    if (!stackId || !stacks.some((s) => s.id === stackId)) setStackId(stacks[0].id)
  }, [hasStacks, stackId, stacks])

  useEffect(() => {
    popupOpenRef.current = Boolean(popup)
    if (!popup) replaceSelectionRef.current = null
  }, [popup])

  // Only source of truth: selections inside CodeViewer editors.
  useEffect(() => {
    const onSelection = (event: Event) => {
      const detail = (event as CustomEvent<ConverterSelectionDetail | null>).detail
      // Empty selection / editor blur: cancel a pending show, but leave an open
      // popup alone so the user can interact with it (closing is handled by
      // outside-click / Escape).
      if (!detail || !detail.text?.trim()) {
        window.clearTimeout(showTimerRef.current)
        return
      }
      pendingDetailRef.current = detail
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = window.setTimeout(() => {
        const d = pendingDetailRef.current
        if (!d) return
        replaceSelectionRef.current = d.replaceSelection ?? null
        setPreview('')
        setPreviewError(false)
        setPos({ left: -9999, top: -9999 })
        setPopup({
          text: d.text.slice(0, 25000),
          anchor: { x: d.x, y: d.y },
          canReplace: Boolean(d.canReplace && d.replaceSelection),
        })
      }, SHOW_DELAY)
    }

    window.addEventListener('pandora:converter-selection', onSelection as EventListener)
    return () => {
      window.removeEventListener('pandora:converter-selection', onSelection as EventListener)
      window.clearTimeout(showTimerRef.current)
    }
  }, [])

  // Dismissal.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!popupOpenRef.current) return
      const target = event.target as Element | null
      if (!target) return
      if (popupRef.current?.contains(target)) return
      if (target.closest('[data-radix-popper-content-wrapper]')) return
      setPopup(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && popupOpenRef.current) setPopup(null)
    }
    const onResize = () => setPopup(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // Live, debounced preview.
  useEffect(() => {
    if (!popup) return
    let cancelled = false
    const t = window.setTimeout(async () => {
      setBusy(true)
      try {
        const r =
          mode === 'stack' && stackId
            ? await api.converter.runStack({ input: popup.text, stack_id: stackId })
            : await api.converter.transform({ input: popup.text, algorithm })
        if (!cancelled) { setPreview(r.output); setPreviewError(false) }
      } catch (e) {
        if (!cancelled) { setPreview(e instanceof Error ? e.message : 'Conversion failed'); setPreviewError(true) }
      } finally {
        if (!cancelled) setBusy(false)
      }
    }, PREVIEW_DELAY)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [popup, mode, algorithm, stackId])

  // Measure-and-place: clamp horizontally, flip above when there's no room below.
  useLayoutEffect(() => {
    if (!popup || !popupRef.current) return
    const el = popupRef.current
    const w = el.offsetWidth || POPUP_WIDTH
    const h = el.offsetHeight
    let left = Math.min(Math.max(EDGE_PAD, popup.anchor.x), window.innerWidth - w - EDGE_PAD)
    let top = popup.anchor.y
    if (top + h + EDGE_PAD > window.innerHeight) {
      const above = popup.anchor.y - h - 28 // anchor sits just below the selection line
      top = above >= EDGE_PAD ? above : Math.max(EDGE_PAD, window.innerHeight - h - EDGE_PAD)
    }
    setPos({ left, top })
  }, [popup, preview, busy, mode, algorithms.length, hasStacks])

  const selectedSummary = useMemo(
    () => (popup ? popup.text.replace(/\s+/g, ' ').trim() : ''),
    [popup],
  )

  if (!popup) return null

  const copyResult = () => {
    navigator.clipboard.writeText(preview).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }
  const doReplace = () => {
    const replacer = replaceSelectionRef.current
    if (replacer && !previewError && preview) {
      replacer(preview)
      setPopup(null)
    }
  }
  const openInConverter = () => {
    sendToConverter(popup.text, mode === 'algorithm' ? algorithm : undefined)
    navigate('/converter')
    setPopup(null)
  }

  return (
    <div
      ref={popupRef}
      className="fixed z-[80] w-[360px] overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Convert</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {popup.text.length} chars
        </span>
        <button
          onClick={() => setPopup(null)}
          className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          title="Close"
        >
          <X size={13} />
        </button>
      </div>

      <div className="space-y-2 p-3">
        {/* Selected snippet */}
        <div className="line-clamp-2 break-all rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-[11px] text-foreground/80">
          {selectedSummary}
        </div>

        {/* Mode toggle + input */}
        {hasStacks && (
          <div className="flex items-center rounded-lg border border-border bg-background p-0.5 text-[11px]">
            {(['algorithm', 'stack'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'flex-1 rounded-md py-1 font-medium capitalize transition-colors',
                  mode === m ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {mode === 'algorithm' ? (
          <Select
            value={algorithm}
            onChange={setAlgorithm}
            options={algorithms.map((a) => ({ value: a.id, label: a.label }))}
            className="h-8"
            searchable
            searchPlaceholder="Search algorithms…"
          />
        ) : (
          <Select
            value={stackId}
            onChange={setStackId}
            options={stacks.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="Select stack"
            className="h-8"
          />
        )}

        {/* Result */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Result{busy ? ' · …' : ''}
            </span>
            {preview && !previewError && (
              <button
                onClick={copyResult}
                className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          <div
            className={cn(
              'max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md border p-2 font-mono text-[11px]',
              previewError
                ? 'border-red-500/40 bg-red-500/10 text-red-300'
                : 'border-border bg-background text-foreground',
            )}
          >
            {preview || (busy ? '' : '—')}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
        <button
          onClick={openInConverter}
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open in Converter <ArrowRight size={12} />
        </button>
        {popup.canReplace && (
          <button
            onClick={doReplace}
            disabled={busy || previewError || !preview}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Replace size={12} /> Replace
          </button>
        )}
      </div>
    </div>
  )
}
