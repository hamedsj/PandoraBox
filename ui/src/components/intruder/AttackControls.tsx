import { Play, Square, Trash2 } from 'lucide-react'
import type { IntruderSession } from '@/store/intruder'

interface Props {
  session: IntruderSession
  concurrency: number
  onConcurrencyChange: (v: number) => void
  onStart: () => void
  onStop: () => void
  onClear: () => void
}

export function AttackControls({ session, concurrency, onConcurrencyChange, onStart, onStop, onClear }: Props) {
  const { status, progress } = session
  const running = status === 'running'
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={running}
          onClick={onStart}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Play size={13} />
          {status === 'done' ? 'Re-run' : 'Start'}
        </button>

        {running && (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500/20 text-red-400 border border-red-500/30 text-sm hover:bg-red-500/30 transition-colors"
          >
            <Square size={13} />
            Stop
          </button>
        )}

        <button
          type="button"
          disabled={running || session.results.length === 0}
          onClick={onClear}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Trash2 size={13} />
          Clear
        </button>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">Concurrency</span>
          <input
            type="range"
            min={1}
            max={20}
            value={concurrency}
            onChange={(e) => onConcurrencyChange(Number(e.target.value))}
            className="w-24 accent-primary"
          />
          <span className="text-xs text-foreground w-4 text-right">{concurrency}</span>
        </div>
      </div>

      {(running || status === 'done') && progress.total > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{progress.done.toLocaleString()} / {progress.total.toLocaleString()} requests</span>
            <span>{percent}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-150"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {status === 'error' && (
        <p className="text-xs text-red-400">Attack failed. Check console for details.</p>
      )}
      {status === 'done' && (
        <p className="text-xs text-emerald-400">
          Done — {session.results.length.toLocaleString()} result{session.results.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
