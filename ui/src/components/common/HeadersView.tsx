/**
 * HeadersView — renders parsed HTTP headers with syntax-aware coloring.
 *
 * Cookie / Set-Cookie values get special treatment: cookie names are
 * highlighted in amber, values in sky-blue, separators muted — matching
 * the Monaco http-request language token colors.
 */

import { Highlight, type HighlightSpec } from '@/components/common/Highlight'

/** Parse a raw JSON headers string into a Record. Returns {} on failure. */
export function parseHeadersJSON(raw: string | undefined): Record<string, string[]> {
  if (!raw) return {}
  try { return JSON.parse(raw) as Record<string, string[]> } catch { return {} }
}

function CookieValue({ value }: { value: string }) {
  const pairs = value.split(/;\s*/)
  return (
    <>
      {pairs.map((pair, i) => {
        const eqIdx = pair.indexOf('=')
        return (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground">; </span>}
            {eqIdx === -1 ? (
              // Bare flag: Secure, HttpOnly, etc.
              <span className="text-sky-500 dark:text-sky-300">{pair}</span>
            ) : (
              <>
                <span className="text-amber-600 dark:text-amber-400">{pair.slice(0, eqIdx)}</span>
                <span className="text-muted-foreground">=</span>
                <span className="text-sky-600 dark:text-sky-300">{pair.slice(eqIdx + 1)}</span>
              </>
            )}
          </span>
        )
      })}
    </>
  )
}

interface HeadersViewProps {
  headers: Record<string, string[]>
  highlight?: HighlightSpec | null
}

export function HeadersView({ headers, highlight }: HeadersViewProps) {
  const entries = Object.entries(headers)
  if (entries.length === 0) return null

  return (
    <div className="min-w-0 max-w-full space-y-0.5">
      {entries.map(([name, values]) => {
        const isCookie = name.toLowerCase() === 'cookie' || name.toLowerCase() === 'set-cookie'
        return (
          <div key={name} className="max-w-full font-mono text-xs leading-relaxed">
            <span className="whitespace-nowrap text-primary"><Highlight text={name} spec={highlight} /></span>
            <span className="text-muted-foreground">: </span>
            {isCookie
              ? values.map((v, i) => (
                  <span key={i} className="break-all">
                    {i > 0 && <span className="text-muted-foreground">, </span>}
                    <CookieValue value={v} />
                  </span>
                ))
              : (
                <span className="break-all text-foreground">
                  <Highlight text={values.join(', ')} spec={highlight} />
                </span>
              )
            }
          </div>
        )
      })}
    </div>
  )
}
