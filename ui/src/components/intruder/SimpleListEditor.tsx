import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { BUILTIN_LISTS } from '@/lib/builtinPayloads'

interface Props {
  values: string[]
  onChange: (values: string[]) => void
}

export function SimpleListEditor({ values, onChange }: Props) {
  const [showBuiltins, setShowBuiltins] = useState(false)

  const text = values.join('\n')

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {values.filter((v) => v.trim()).length} payloads — one per line
        </span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowBuiltins((v) => !v)}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:border-zinc-500 hover:text-foreground text-muted-foreground transition-colors"
          >
            Load built-in list <ChevronDown size={11} />
          </button>
          {showBuiltins && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-border bg-card shadow-lg py-1">
              {BUILTIN_LISTS.map((list) => (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => {
                    onChange(list.values)
                    setShowBuiltins(false)
                  }}
                  className="flex w-full items-center justify-between gap-4 px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
                >
                  <span>{list.label}</span>
                  <span className="text-xs text-muted-foreground">{list.values.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <textarea
        className="w-full rounded-md border border-border bg-background font-mono text-xs px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary h-48"
        placeholder="Enter one payload per line…"
        value={text}
        onChange={(e) => onChange(e.target.value.split('\n'))}
        spellCheck={false}
      />
    </div>
  )
}
