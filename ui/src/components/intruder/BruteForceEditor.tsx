import { countPayloads } from '@/lib/intruderPayloads'

const CHARSET_PRESETS = [
  { label: 'a-z', value: 'abcdefghijklmnopqrstuvwxyz' },
  { label: 'A-Z', value: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
  { label: '0-9', value: '0123456789' },
  { label: 'a-z + 0-9', value: 'abcdefghijklmnopqrstuvwxyz0123456789' },
  { label: 'Alphanumeric', value: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' },
  { label: 'Hex', value: '0123456789abcdef' },
]

interface Props {
  charset: string
  minLen: number
  maxLen: number
  onChange: (patch: { charset?: string; minLen?: number; maxLen?: number }) => void
}

export function BruteForceEditor({ charset, minLen, maxLen, onChange }: Props) {
  const count = countPayloads({ type: 'bruteforce', charset, minLen, maxLen })
  const tooMany = count > 100_000

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Charset</span>
        <input
          type="text"
          value={charset}
          onChange={(e) => onChange({ charset: e.target.value })}
          className="rounded-md border border-border bg-background font-mono px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="e.g. abc123"
        />
        <div className="flex flex-wrap gap-1 mt-1">
          {CHARSET_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange({ charset: p.value })}
              className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:border-zinc-500 text-muted-foreground hover:text-foreground transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Min length</span>
          <input
            type="number"
            min={1}
            max={maxLen}
            value={minLen}
            onChange={(e) => onChange({ minLen: Math.max(1, Number(e.target.value)) })}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Max length</span>
          <input
            type="number"
            min={minLen}
            value={maxLen}
            onChange={(e) => onChange({ maxLen: Math.max(minLen, Number(e.target.value)) })}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
      </div>

      <p className={`text-xs ${tooMany ? 'text-amber-400' : 'text-muted-foreground'}`}>
        {count > 1_000_000
          ? `~${(count / 1_000_000).toFixed(1)}M payloads`
          : count.toLocaleString() + ` payload${count !== 1 ? 's' : ''}`}
        {tooMany && ' — large set, may take a while'}
      </p>
    </div>
  )
}
