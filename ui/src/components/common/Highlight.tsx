import { Fragment } from 'react'
import { cn } from '@/lib/utils'

export interface HighlightSpec {
  term: string
  caseInsensitive: boolean
  useRegex: boolean
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build a global RegExp for a search spec, or null if the term is empty/invalid. */
export function buildHighlightRegex(spec: HighlightSpec | null | undefined): RegExp | null {
  if (!spec || !spec.term) return null
  const flags = spec.caseInsensitive ? 'gi' : 'g'
  try {
    return new RegExp(spec.useRegex ? spec.term : escapeRegExp(spec.term), flags)
  } catch {
    return null
  }
}

/**
 * Renders `text` with every match of the search spec wrapped in a highlight
 * mark. Used in the history table and the headers view so matched substrings
 * are visible at a glance.
 */
export function Highlight({
  text,
  spec,
  className,
}: {
  text: string
  spec: HighlightSpec | null | undefined
  className?: string
}) {
  const re = buildHighlightRegex(spec)
  if (!re || !text) return <>{text}</>

  const out: React.ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>)
    out.push(
      <mark
        key={key++}
        className={cn('rounded-[2px] bg-amber-300/40 text-foreground dark:bg-amber-300/30', className)}
      >
        {m[0]}
      </mark>,
    )
    last = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++ // guard against zero-width matches
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>)
  return <>{out}</>
}
