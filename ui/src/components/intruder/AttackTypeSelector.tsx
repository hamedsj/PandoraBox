import type { AttackType } from '@/store/intruder'

interface Option {
  value: AttackType
  label: string
  desc: string
}

const OPTIONS: Option[] = [
  { value: 'sniper',       label: 'Sniper',        desc: 'One position at a time, cycle all payloads through each' },
  { value: 'battering_ram', label: 'Battering Ram', desc: 'Same payload inserted at all positions simultaneously' },
  { value: 'pitchfork',    label: 'Pitchfork',     desc: 'Parallel iteration across multiple payload sets' },
  { value: 'cluster_bomb', label: 'Cluster Bomb',  desc: 'Every combination of all payload sets (cartesian product)' },
]

interface Props {
  value: AttackType
  onChange: (v: AttackType) => void
}

export function AttackTypeSelector({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`text-left px-3 py-2 rounded-lg border transition-colors ${
            value === opt.value
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border hover:border-zinc-500 text-muted-foreground hover:text-foreground'
          }`}
        >
          <div className="text-sm font-medium">{opt.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{opt.desc}</div>
        </button>
      ))}
    </div>
  )
}
