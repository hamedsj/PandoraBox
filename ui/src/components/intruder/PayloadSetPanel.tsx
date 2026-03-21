import { SimpleListEditor } from './SimpleListEditor'
import { NumbersEditor } from './NumbersEditor'
import { BruteForceEditor } from './BruteForceEditor'
import type { PayloadConfig } from '@/store/intruder'
import type { PayloadSource } from '@/lib/intruderPayloads'

interface Props {
  markerCount: number
  payloadSets: PayloadConfig[]
  activeMarker: number
  onSelectMarker: (i: number) => void
  onChange: (index: number, cfg: PayloadConfig) => void
}

type SourceType = PayloadSource['type']

export function PayloadSetPanel({ markerCount, payloadSets, activeMarker, onSelectMarker, onChange }: Props) {
  const cfg = payloadSets[activeMarker] ?? { source: { type: 'list', values: [] } }
  const source = cfg.source

  function setSource(next: PayloadSource) {
    onChange(activeMarker, { source: next })
  }

  function setType(type: SourceType) {
    if (type === 'list') setSource({ type: 'list', values: [] })
    else if (type === 'numbers') setSource({ type: 'numbers', from: 1, to: 100, step: 1 })
    else if (type === 'bruteforce') setSource({ type: 'bruteforce', charset: 'abcdefghijklmnopqrstuvwxyz', minLen: 1, maxLen: 3 })
  }

  if (markerCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2 py-8">
        <span>No §markers§ found in the request.</span>
        <span className="text-xs">Use Auto-Mark or type §value§ around positions you want to fuzz.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Marker tabs */}
      {markerCount > 1 && (
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: markerCount }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelectMarker(i)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                activeMarker === i
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              Marker {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Source type selector */}
      <div className="flex gap-1">
        {(['list', 'numbers', 'bruteforce'] as SourceType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`px-2.5 py-1 rounded text-xs border transition-colors ${
              source.type === t
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-zinc-500'
            }`}
          >
            {t === 'list' ? 'Simple List' : t === 'numbers' ? 'Numbers' : 'Brute Force'}
          </button>
        ))}
      </div>

      {/* Editor */}
      {source.type === 'list' && (
        <SimpleListEditor
          values={source.values}
          onChange={(values) => setSource({ type: 'list', values })}
        />
      )}
      {source.type === 'numbers' && (
        <NumbersEditor
          from={source.from}
          to={source.to}
          step={source.step}
          onChange={(patch) => setSource({ ...source, ...patch })}
        />
      )}
      {source.type === 'bruteforce' && (
        <BruteForceEditor
          charset={source.charset}
          minLen={source.minLen}
          maxLen={source.maxLen}
          onChange={(patch) => setSource({ ...source, ...patch })}
        />
      )}
    </div>
  )
}
