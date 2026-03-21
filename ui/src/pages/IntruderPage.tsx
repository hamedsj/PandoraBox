import { useState } from 'react'
import { Crosshair } from 'lucide-react'
import { useIntruderStore } from '@/store/intruder'
import { parseMarkers } from '@/lib/intruderAttack'
import { SessionTabs } from '@/components/intruder/SessionTabs'
import { RawEditor } from '@/components/intruder/RawEditor'
import { AttackTypeSelector } from '@/components/intruder/AttackTypeSelector'
import { PayloadSetPanel } from '@/components/intruder/PayloadSetPanel'
import { AttackControls } from '@/components/intruder/AttackControls'
import { ResultsTable } from '@/components/intruder/ResultsTable'
import type { AttackType, PayloadConfig } from '@/store/intruder'

export function IntruderPage() {
  const {
    sessions, activeSessionId,
    addSession, removeSession, setActiveSession,
    updateSession, startAttack, stopAttack, clearResults,
  } = useIntruderStore()

  const [concurrency, setConcurrency] = useState(5)
  const [activeMarker, setActiveMarker] = useState(0)

  const session = sessions.find((s) => s.id === activeSessionId) ?? null
  const markers = session ? parseMarkers(session.raw) : []

  function handleAddEmpty() {
    const id = crypto.randomUUID()
    const name = `Session ${sessions.length + 1}`
    useIntruderStore.setState((s) => ({
      sessions: [...s.sessions, {
        id, name, raw: '', requestId: 0,
        attackType: 'sniper' as AttackType,
        payloadSets: [],
        results: [],
        status: 'idle',
        progress: { done: 0, total: 0 },
      }],
      activeSessionId: id,
    }))
  }

  function handlePayloadChange(index: number, cfg: PayloadConfig) {
    if (!session) return
    const next = [...session.payloadSets]
    next[index] = cfg
    updateSession(session.id, { payloadSets: next })
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <Crosshair size={48} className="opacity-20" />
        <div className="text-center">
          <p className="text-base font-medium text-foreground">Intruder</p>
          <p className="text-sm mt-1">Right-click any request and select "Send to Intruder" to get started.</p>
        </div>
        <button
          onClick={handleAddEmpty}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/80 transition-colors"
        >
          New Empty Session
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Session tabs */}
      <SessionTabs
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={setActiveSession}
        onAdd={handleAddEmpty}
        onClose={removeSession}
      />

      {session && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* LEFT panel: editor + config */}
          <div className="w-[480px] shrink-0 flex flex-col gap-0 border-r border-border overflow-hidden">
            {/* Raw editor */}
            <div className="flex-1 min-h-0 p-3 flex flex-col">
              <RawEditor
                value={session.raw}
                onChange={(raw) => {
                  updateSession(session.id, { raw })
                  setActiveMarker(0)
                }}
              />
            </div>

            {/* Config section */}
            <div className="border-t border-border p-3 flex flex-col gap-4 overflow-y-auto max-h-80">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Attack Type</p>
                <AttackTypeSelector
                  value={session.attackType}
                  onChange={(attackType) => updateSession(session.id, { attackType })}
                />
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Payload Sets
                  {markers.length > 0 && (
                    <span className="ml-1.5 text-primary font-normal normal-case">{markers.length} marker{markers.length !== 1 ? 's' : ''}</span>
                  )}
                </p>
                <PayloadSetPanel
                  markerCount={markers.length}
                  payloadSets={session.payloadSets}
                  activeMarker={activeMarker}
                  onSelectMarker={setActiveMarker}
                  onChange={handlePayloadChange}
                />
              </div>
            </div>
          </div>

          {/* RIGHT panel: controls + results */}
          <div className="flex-1 min-w-0 flex flex-col gap-0 overflow-hidden">
            {/* Attack controls */}
            <div className="p-3 border-b border-border shrink-0">
              <AttackControls
                session={session}
                concurrency={concurrency}
                onConcurrencyChange={setConcurrency}
                onStart={() => startAttack(session.id)}
                onStop={() => stopAttack(session.id)}
                onClear={() => clearResults(session.id)}
              />
            </div>

            {/* Results */}
            <div className="flex-1 min-h-0 p-3">
              <ResultsTable
                results={session.results}
                markerCount={Math.max(markers.length, 1)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
