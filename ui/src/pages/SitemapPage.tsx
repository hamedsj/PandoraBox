import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ChevronDown, Filter, Globe, Network, Waypoints } from 'lucide-react'
import { useRequests } from '@/hooks/useRequests'
import { useProxyStore } from '@/store/proxy'
import { FilterModal } from '@/components/history/FilterModal'
import { RequestInspector } from '@/components/inspector/RequestInspector'
import { RequestWorkspaceLayout } from '@/components/layout/RequestWorkspaceLayout'
import { SitemapTree } from '@/components/sitemap/SitemapTree'
import { buildSitemapTree, collectBranchIds, countUniqueRoutes, getDefaultExpanded } from '@/lib/sitemap'
import { countActiveFilters, filterRequests } from '@/lib/requestFilters'
import { exportSelected } from '@/lib/sitemapExport'
import { cn } from '@/lib/utils'
import { subscribeShortcutAction } from '@/lib/shortcuts'
import { useWorkspaceStore } from '@/store/workspace'
import { api } from '@/api/client'

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: string
  hint: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card/80 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.12)] backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
        <Icon size={16} className="text-primary" />
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  )
}

export function SitemapPage() {
  useRequests()

  const requests = useProxyStore((state) => state.requests)
  const filters = useProxyStore((state) => state.filters)
  const project = useProxyStore((state) => state.project)
  const selectedRequestId = useProxyStore((state) => state.selectedRequestId)
  const setSelectedRequestId = useProxyStore((state) => state.setSelectedRequestId)
  const inspectorPosition = useWorkspaceStore((state) => state.inspectorPosition)
  const sitemapRightSplit = useWorkspaceStore((state) => state.sitemapRightSplit)
  const sitemapBottomSplit = useWorkspaceStore((state) => state.sitemapBottomSplit)
  const setSitemapRightSplit = useWorkspaceStore((state) => state.setSitemapRightSplit)
  const setSitemapBottomSplit = useWorkspaceStore((state) => state.setSitemapBottomSplit)

  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const expansionInitialized = useRef(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  const filteredRequests = useMemo(() => filterRequests(requests, filters), [requests, filters])
  const tree = useMemo(() => buildSitemapTree(filteredRequests), [filteredRequests])
  const activeFilterCount = countActiveFilters(filters)
  const hostCount = tree.length
  const routeCount = useMemo(() => countUniqueRoutes(filteredRequests), [filteredRequests])
  const responseCount = filteredRequests.filter((request) => request.response).length
  const splitPct = inspectorPosition === 'bottom' ? sitemapBottomSplit : sitemapRightSplit

  // Prune selected IDs when filtered requests change
  useEffect(() => {
    const visibleIds = new Set(filteredRequests.map((r) => r.id))
    setSelectedIds((prev) => {
      const next = new Set<number>()
      for (const id of prev) {
        if (visibleIds.has(id)) next.add(id)
      }
      return next.size === prev.size ? prev : next
    })
  }, [filteredRequests])

  useEffect(() => {
    const validIds = collectBranchIds(tree)
    setExpanded((current) => {
      if (!expansionInitialized.current) {
        expansionInitialized.current = true
        return new Set(getDefaultExpanded(tree))
      }

      const next = new Set<string>()
      for (const id of current) {
        if (validIds.has(id)) next.add(id)
      }
      return next
    })
  }, [tree])

  useEffect(() => {
    if (selectedRequestId == null) return
    const stillVisible = filteredRequests.some((request) => request.id === selectedRequestId)
    if (!stillVisible) setSelectedRequestId(null)
  }, [filteredRequests, selectedRequestId, setSelectedRequestId])

  useEffect(() => {
    return subscribeShortcutAction((actionId) => {
      if (actionId === 'common.openFilters') {
        setFilterModalOpen(true)
      } else if (actionId === 'common.closeCurrent' || actionId === 'common.escape') {
        setFilterModalOpen(false)
        setExportMenuOpen(false)
      }
    })
  }, [])

  // Close export menu on outside click
  useEffect(() => {
    if (!exportMenuOpen) return
    function handle() { setExportMenuOpen(false) }
    document.addEventListener('click', handle)
    return () => document.removeEventListener('click', handle)
  }, [exportMenuOpen])

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function expandHosts() {
    setExpanded(new Set(tree.map((node) => node.id)))
  }

  function collapseAll() {
    setExpanded(new Set())
  }

  function onToggleSelect(ids: number[], forceValue?: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        const doSet = forceValue ?? !prev.has(id)
        doSet ? next.add(id) : next.delete(id)
      }
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(filteredRequests.map((r) => r.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  async function doExport(format: 'json' | 'har') {
    setExportMenuOpen(false)
    await exportSelected(Array.from(selectedIds), format, api.requests.get)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.14),transparent_32%),radial-gradient(circle_at_top_right,hsl(var(--primary)/0.08),transparent_28%)]">
      <div className="overflow-auto px-5 pb-5 pt-5">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
          <section className="relative overflow-hidden rounded-[30px] border border-border/80 bg-card/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.16)] backdrop-blur-sm">
            <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.03),transparent)]" />
            <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                  <Network size={13} />
                  SiteMap
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border bg-background/80 px-3 py-1">
                    Project: <span className="font-semibold text-foreground">{project?.name ?? 'Loading...'}</span>
                  </span>
                  <span className="rounded-full border border-border bg-background/80 px-3 py-1">
                    Scope: <span className={cn('font-semibold', project?.scope.enabled ? 'text-foreground' : 'text-muted-foreground')}>{project?.scope.enabled ? 'enabled' : 'all traffic capture'}</span>
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setFilterModalOpen(true)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all',
                    activeFilterCount > 0
                      ? 'border-primary/40 bg-primary/12 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]'
                      : 'border-border bg-background/80 text-foreground hover:bg-muted'
                  )}
                >
                  <Filter size={16} />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={expandHosts}
                  className="rounded-xl border border-border bg-background/80 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Expand Hosts
                </button>
                <button
                  onClick={collapseAll}
                  className="rounded-xl border border-border bg-background/80 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Collapse All
                </button>
              </div>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            <StatCard label="Hosts" value={hostCount.toString()} hint="Distinct in-scope domains in the tree" icon={Globe} />
            <StatCard label="Routes" value={routeCount.toString()} hint="Unique host + path combinations after filtering" icon={Waypoints} />
            <StatCard label="Requests" value={filteredRequests.length.toString()} hint="Captured exchanges currently visible" icon={Network} />
            <StatCard label="Responses" value={responseCount.toString()} hint="Requests that already have a recorded response" icon={Activity} />
          </section>

          <section className={cn('min-h-[720px]', inspectorPosition === 'bottom' && 'min-h-[920px]')}>
            <RequestWorkspaceLayout
              position={inspectorPosition}
              splitPct={splitPct}
              onSplitChange={inspectorPosition === 'bottom' ? setSitemapBottomSplit : setSitemapRightSplit}
              inspectorVisible={Boolean(selectedRequestId)}
              className="gap-0"
              primaryClassName={cn(
                selectedRequestId && inspectorPosition === 'right' && 'pr-5',
                selectedRequestId && inspectorPosition === 'bottom' && 'pb-5'
              )}
              inspectorClassName={cn(inspectorPosition === 'right' && 'pl-5', inspectorPosition === 'bottom' && 'pt-5')}
              primary={(
                <div className="h-full overflow-hidden rounded-[30px] border border-border/80 bg-card/80 shadow-[0_20px_60px_rgba(0,0,0,0.12)] backdrop-blur-sm">
                  <div className="flex items-center justify-between border-b border-border/80 px-5 py-4">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Tree View</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={selectAll}
                        className="rounded-lg border border-border bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        Select All
                      </button>
                      {selectedIds.size > 0 && (
                        <button
                          onClick={clearSelection}
                          className="rounded-lg border border-border bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                        >
                          Clear
                        </button>
                      )}
                      {selectedIds.size > 0 && (
                        <div className="relative">
                          <button
                            onClick={(e) => { e.stopPropagation(); setExportMenuOpen((v) => !v) }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/12 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                          >
                            Export {selectedIds.size}
                            <ChevronDown size={12} />
                          </button>
                          {exportMenuOpen && (
                            <div
                              className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => doExport('json')}
                                className="flex w-full items-center px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                              >
                                Export as JSON
                              </button>
                              <button
                                onClick={() => doExport('har')}
                                className="flex w-full items-center px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                              >
                                Export as HAR
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="whitespace-nowrap rounded-full border border-border bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        In Scope
                      </div>
                    </div>
                  </div>
                  <div className="h-[calc(100%-77px)] overflow-auto p-4">
                    <SitemapTree
                      tree={tree}
                      expanded={expanded}
                      selectedRequestId={selectedRequestId}
                      onToggle={toggleExpanded}
                      onSelectRequest={setSelectedRequestId}
                      selectedIds={selectedIds}
                      onToggleSelect={onToggleSelect}
                    />
                  </div>
                </div>
              )}
              inspector={(
                <div className="h-full overflow-hidden rounded-[30px] border border-border/80 bg-card/80 shadow-[0_20px_60px_rgba(0,0,0,0.12)] backdrop-blur-sm">
                  <RequestInspector edge="none" />
                </div>
              )}
            />
          </section>
        </div>
      </div>

      <FilterModal isOpen={filterModalOpen} onClose={() => setFilterModalOpen(false)} />
    </div>
  )
}
