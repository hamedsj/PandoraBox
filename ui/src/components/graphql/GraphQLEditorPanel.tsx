import { useEffect, useMemo, useRef, useState } from 'react'
import { Braces, Database, FileCode2, FileJson2, Sparkles } from 'lucide-react'
import { CodeViewer } from '@/components/common/CodeViewer'
import { cn } from '@/lib/utils'
import { detectGraphQLPacket, formatGraphQLQuery, updateGraphQLPacket } from '@/lib/graphql'

interface GraphQLEditorPanelProps {
  rawPacket: string
  onChange: (raw: string) => void
  readOnly?: boolean
  includeFullPacket?: boolean
}

type Tab = 'full-packet' | 'operation' | 'variables' | 'extensions' | 'body'

const GRAPHQL_EDITOR_MIN_HEIGHT = 110
const GRAPHQL_EDITOR_SPARE_LINES = 5

export function GraphQLEditorPanel({ rawPacket, onChange, readOnly = false, includeFullPacket = false }: GraphQLEditorPanelProps) {
  const graphQL = useMemo(() => detectGraphQLPacket(rawPacket), [rawPacket])
  const [activeTab, setActiveTab] = useState<Tab>(includeFullPacket ? 'full-packet' : 'operation')
  const [error, setError] = useState('')
  const [queryDraft, setQueryDraft] = useState('')
  const [variablesDraft, setVariablesDraft] = useState('')
  const [extensionsDraft, setExtensionsDraft] = useState('')
  const lastAppliedRawRef = useRef('')

  useEffect(() => {
    if (!graphQL) return
    if (rawPacket && rawPacket === lastAppliedRawRef.current) return
    setQueryDraft(graphQL.query)
    setVariablesDraft(graphQL.variablesText)
    setExtensionsDraft(graphQL.extensionsText)
    setError('')
  }, [rawPacket, graphQL])

  if (!graphQL) return null
  const gql = graphQL

  const tabs: Array<{ id: Tab; label: string; icon: typeof Braces; disabled?: boolean }> = [
    ...(includeFullPacket ? [{ id: 'full-packet' as const, label: 'Full Packet', icon: FileCode2 }] : []),
    { id: 'operation', label: 'Operation', icon: Braces },
    { id: 'variables', label: 'Variables', icon: Database, disabled: gql.transport !== 'json' },
    { id: 'extensions', label: 'Extensions', icon: Sparkles, disabled: gql.transport !== 'json' },
    { id: 'body', label: 'JSON Body', icon: FileJson2, disabled: gql.transport !== 'json' },
  ]

  const fallbackTab = includeFullPacket ? 'full-packet' : 'operation'
  const safeActiveTab = tabs.some((tab) => tab.id === activeTab && !tab.disabled) ? activeTab : fallbackTab

  function patch(next: { query?: string; variablesText?: string; operationName?: string; extensionsText?: string }) {
    setError('')
    const result = updateGraphQLPacket(rawPacket, next)
    if (result.error) {
      setError(result.error)
      return
    }
    lastAppliedRawRef.current = result.raw
    onChange(result.raw)
  }

  function prettifyOperation() {
    const next = formatGraphQLQuery(queryDraft || gql.query)
    setQueryDraft(next)
    patch({ query: next })
  }

  function prettifyJSON(kind: 'variablesText' | 'extensionsText') {
    try {
      const source = kind === 'variablesText' ? gql.variablesText : gql.extensionsText
      if (!source.trim()) return
      const next = JSON.stringify(JSON.parse(source), null, 2)
      if (kind === 'variablesText') {
        setVariablesDraft(next)
        patch({ variablesText: next })
      } else {
        setExtensionsDraft(next)
        patch({ extensionsText: next })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON')
    }
  }

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="rounded-lg border border-primary/30 bg-primary/10 p-1 text-primary">
            <Braces size={14} />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">GraphQL</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {gql.operationName || 'anonymous operation'} · {gql.transport === 'json' ? 'JSON transport' : 'raw GraphQL transport'}
            </div>
          </div>
        </div>
        {!readOnly && (
          <button
            onClick={prettifyOperation}
            className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Prettify Operation
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border/60 px-3 py-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              disabled={tab.disabled}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                safeActiveTab === tab.id
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                tab.disabled && 'cursor-not-allowed opacity-35 hover:bg-transparent hover:text-muted-foreground',
              )}
            >
              <Icon size={12} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="mx-3 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="p-3">
        {safeActiveTab === 'full-packet' && (
          <CodeViewer
            value={rawPacket}
            language="http-request"
            readOnly={readOnly}
            onChange={onChange}
            flow
            minHeight={GRAPHQL_EDITOR_MIN_HEIGHT}
            maxHeight={620}
            scrollBeyondLastLine={false}
            extraBottomLines={GRAPHQL_EDITOR_SPARE_LINES}
          />
        )}

        {safeActiveTab === 'operation' && (
          <CodeViewer
            value={queryDraft}
            language="graphql"
            readOnly={readOnly}
            onChange={(value) => {
              setQueryDraft(value)
              patch({ query: value })
            }}
            flow
            minHeight={GRAPHQL_EDITOR_MIN_HEIGHT}
            maxHeight={520}
            scrollBeyondLastLine={false}
            extraBottomLines={GRAPHQL_EDITOR_SPARE_LINES}
          />
        )}

        {safeActiveTab === 'variables' && (
          <div className="space-y-2">
            {!readOnly && (
              <button
                onClick={() => prettifyJSON('variablesText')}
                className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Prettify Variables
              </button>
            )}
            <CodeViewer
              value={variablesDraft || '{}'}
              language="json"
              readOnly={readOnly}
              onChange={(value) => {
                setVariablesDraft(value)
                patch({ variablesText: value })
              }}
              flow
            minHeight={GRAPHQL_EDITOR_MIN_HEIGHT}
              maxHeight={420}
              scrollBeyondLastLine={false}
              extraBottomLines={GRAPHQL_EDITOR_SPARE_LINES}
            />
          </div>
        )}

        {safeActiveTab === 'extensions' && (
          <div className="space-y-2">
            {!readOnly && (
              <button
                onClick={() => prettifyJSON('extensionsText')}
                className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Prettify Extensions
              </button>
            )}
            <CodeViewer
              value={extensionsDraft || '{}'}
              language="json"
              readOnly={readOnly}
              onChange={(value) => {
                setExtensionsDraft(value)
                patch({ extensionsText: value })
              }}
              flow
            minHeight={GRAPHQL_EDITOR_MIN_HEIGHT}
              maxHeight={420}
              scrollBeyondLastLine={false}
              extraBottomLines={GRAPHQL_EDITOR_SPARE_LINES}
            />
          </div>
        )}

        {safeActiveTab === 'body' && (
          <CodeViewer
            value={gql.bodyText}
            language="json"
            readOnly
            flow
            minHeight={GRAPHQL_EDITOR_MIN_HEIGHT}
            maxHeight={500}
            scrollBeyondLastLine={false}
            extraBottomLines={GRAPHQL_EDITOR_SPARE_LINES}
          />
        )}
      </div>
    </div>
  )
}
