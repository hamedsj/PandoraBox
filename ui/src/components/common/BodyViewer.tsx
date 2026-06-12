import { useMemo, useState } from 'react'
import { Copy, WrapText } from 'lucide-react'
import { copyText } from '@/lib/clipboard'
import { CodeViewer } from '@/components/common/CodeViewer'
import type { HighlightSpec } from '@/components/common/Highlight'
import type { DecodedBody } from '@/lib/httpBodies'
import { presentBody } from '@/lib/bodyPresentation'
import { hexDump } from '@/lib/hex'
import { cn } from '@/lib/utils'

type Mode = 'pretty' | 'raw' | 'hex'

interface BodyViewerProps {
  body: DecodedBody
  title?: string
  /** Max rendered height before the editor scrolls internally. */
  maxHeight?: number
  /** Highlight + reveal a search term inside the body. */
  highlight?: HighlightSpec | null
  /** Ctrl/Cmd+F inside the editor calls this instead of Monaco's find. */
  onRequestFind?: () => void
  /** Controlled view mode (persisted by the host). Falls back to internal state. */
  mode?: Mode
  onModeChange?: (mode: Mode) => void
  /** Stable key for persisting editor scroll/cursor across remounts. */
  viewStateKey?: string
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </span>
  )
}

/**
 * BodyViewer renders an HTTP body with Pretty / Raw / Hex modes.
 *  - Pretty: prettified, syntax-highlighted (JSON/HTML/XML/GraphQL).
 *  - Raw:    the exact decoded bytes as text — never reformatted or lossy.
 *  - Hex:    offset + hex + ASCII dump of the exact bytes.
 * Decompression (gzip/br/zstd/deflate) already happened upstream; this only
 * decides how the bytes are presented.
 */
export function BodyViewer({
  body,
  title = 'Body',
  maxHeight = 600,
  highlight,
  onRequestFind,
  mode: controlledMode,
  onModeChange,
  viewStateKey,
}: BodyViewerProps) {
  const presentation = useMemo(() => presentBody(body), [body])
  const graphQL = presentation.graphQL

  const rawText = useMemo(
    () => (body.isBinary ? new TextDecoder().decode(body.bytes) : body.text),
    [body],
  )
  const hex = useMemo(() => hexDump(body.bytes), [body.bytes])

  const hasPretty = Boolean(presentation.formatted || graphQL)
  const modes = useMemo<Mode[]>(() => {
    if (body.isBinary) return ['hex', 'raw']
    return hasPretty ? ['pretty', 'raw', 'hex'] : ['raw', 'hex']
  }, [body.isBinary, hasPretty])

  const [internalMode, setInternalMode] = useState<Mode>(modes[0])
  const [wrap, setWrap] = useState(true)

  // Active mode is derived (no reset effect): prefer the controlled/persisted
  // mode, then internal state, falling back to the first available mode when
  // the preferred one isn't valid for this body (e.g. "pretty" on binary).
  const preferred = controlledMode ?? internalMode
  const mode: Mode = modes.includes(preferred) ? preferred : modes[0]
  const selectMode = (m: Mode) => (onModeChange ? onModeChange(m) : setInternalMode(m))

  const isEmpty = body.bytes.length === 0 && rawText.trim().length === 0

  const displayedText = mode === 'hex' ? hex.text : mode === 'raw' ? rawText : presentation.text
  const displayedLanguage =
    mode === 'hex' ? 'plaintext' : mode === 'raw' ? 'plaintext' : presentation.language

  function handleCopy() {
    copyText(mode === 'pretty' && graphQL ? graphQL.formattedQuery : displayedText, 'Copied body')
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">{title}</span>
        <Chip>{body.contentType}</Chip>
        <Chip>{formatBytes(body.bytes.length)}</Chip>
        {body.wasCompressed && <Chip>decoded {body.encoding || 'compressed'}</Chip>}

        <div className="ml-auto flex items-center gap-1.5">
          {/* Mode switch */}
          <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
            {modes.map((m) => (
              <button
                key={m}
                onClick={() => selectMode(m)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors',
                  mode === m
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m}
              </button>
            ))}
          </div>

          {mode !== 'hex' && (
            <button
              onClick={() => setWrap((w) => !w)}
              title={wrap ? 'Disable line wrap' : 'Enable line wrap'}
              className={cn(
                'rounded-md border p-1.5 transition-colors',
                wrap
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <WrapText size={13} />
            </button>
          )}

          <button
            onClick={handleCopy}
            title="Copy"
            className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Copy size={13} />
          </button>
        </div>
      </div>

      {body.error && (
        <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {body.error}
        </div>
      )}

      {mode === 'hex' && hex.truncated && (
        <div className="mb-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
          Showing first {formatBytes(hex.shownBytes)} of {formatBytes(hex.totalBytes)}
        </div>
      )}

      {isEmpty ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
          Empty body
        </div>
      ) : mode === 'pretty' && graphQL ? (
        <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.035] p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 font-semibold uppercase tracking-[0.16em] text-primary">
              {graphQL.operationName || 'anonymous'}
            </span>
            <span>{graphQL.transport === 'json' ? 'JSON GraphQL request' : 'Raw GraphQL request'}</span>
          </div>
          <CodeViewer value={graphQL.formattedQuery} language="graphql" maxHeight={560} minHeight={180} highlight={highlight} onRequestFind={onRequestFind} />
          {graphQL.variablesText && (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Variables
              </div>
              <CodeViewer value={graphQL.variablesText} language="json" maxHeight={320} minHeight={120} highlight={highlight} onRequestFind={onRequestFind} />
            </div>
          )}
          {graphQL.extensionsText && (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Extensions
              </div>
              <CodeViewer value={graphQL.extensionsText} language="json" maxHeight={320} minHeight={120} highlight={highlight} onRequestFind={onRequestFind} />
            </div>
          )}
        </div>
      ) : (
        <CodeViewer
          value={displayedText}
          language={displayedLanguage}
          maxHeight={maxHeight}
          wordWrap={mode === 'hex' ? 'off' : wrap ? 'on' : 'off'}
          highlight={highlight}
          onRequestFind={onRequestFind}
          viewStateKey={viewStateKey ? `${viewStateKey}:${mode}` : undefined}
        />
      )}
    </div>
  )
}
