import { countPayloads } from '@/lib/intruderPayloads'

interface Props {
  from: number
  to: number
  step: number
  onChange: (patch: { from?: number; to?: number; step?: number }) => void
}

export function NumbersEditor({ from, to, step, onChange }: Props) {
  const count = countPayloads({ type: 'numbers', from, to, step })

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">From</span>
          <input
            type="number"
            value={from}
            onChange={(e) => onChange({ from: Number(e.target.value) })}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <input
            type="number"
            value={to}
            onChange={(e) => onChange({ to: Number(e.target.value) })}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Step</span>
          <input
            type="number"
            min={1}
            value={step}
            onChange={(e) => onChange({ step: Math.max(1, Number(e.target.value)) })}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {count.toLocaleString()} payload{count !== 1 ? 's' : ''}
      </p>
    </div>
  )
}
