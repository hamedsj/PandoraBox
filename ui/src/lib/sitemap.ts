import type { Request } from '@/api/client'

function is2xx(req: Request): boolean {
  const status = req.response?.status_code
  return status != null && status >= 200 && status < 300
}

export interface SitemapBranchNode {
  id: string
  kind: 'host' | 'segment'
  label: string
  fullPath: string
  requestCount: number
  responseCount: number
  children: SitemapNode[]
}

export interface SitemapRequestNode {
  id: string
  kind: 'request'
  request: Request
  occurrenceCount: number
  responseCount: number
}

export type SitemapNode = SitemapBranchNode | SitemapRequestNode

interface MutableBranchNode {
  id: string
  kind: 'host' | 'segment'
  label: string
  fullPath: string
  requestCount: number
  responseCount: number
  branches: Map<string, MutableBranchNode>
  leaves: Map<string, SitemapRequestNode>
}

function createBranch(kind: 'host' | 'segment', id: string, label: string, fullPath: string): MutableBranchNode {
  return {
    id,
    kind,
    label,
    fullPath,
    requestCount: 0,
    responseCount: 0,
    branches: new Map(),
    leaves: new Map(),
  }
}

function sortNodes(nodes: SitemapNode[]): SitemapNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind === 'request' && b.kind === 'request') return b.request.id - a.request.id
    if (a.kind === 'request') return 1
    if (b.kind === 'request') return -1
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
  })
}

function finalize(node: MutableBranchNode): SitemapBranchNode {
  const branchChildren = Array.from(node.branches.values()).map(finalize)
  const children = sortNodes([...branchChildren, ...Array.from(node.leaves.values())])

  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    fullPath: node.fullPath,
    requestCount: node.requestCount,
    responseCount: node.responseCount,
    children,
  }
}

export function buildSitemapTree(requests: Request[]): SitemapBranchNode[] {
  const hosts = new Map<string, MutableBranchNode>()

  for (const request of requests) {
    const hostKey = request.host || 'unknown-host'
    let hostNode = hosts.get(hostKey)
    if (!hostNode) {
      hostNode = createBranch('host', `host:${hostKey}`, hostKey, hostKey)
      hosts.set(hostKey, hostNode)
    }

    const parts = request.path
      .split('/')
      .filter(Boolean)
      .map((part) => part || '/')

    let cursor = hostNode
    let currentPath = ''

    for (const part of parts) {
      currentPath += `/${part}`
      let branch = cursor.branches.get(part)
      if (!branch) {
        branch = createBranch('segment', `${cursor.id}:${currentPath}`, part, currentPath)
        cursor.branches.set(part, branch)
      }
      cursor = branch
    }

    const routeKey = `${request.scheme}://${request.host}${request.path || '/'}`
    const existingLeaf = cursor.leaves.get(routeKey)
    if (existingLeaf) {
      existingLeaf.occurrenceCount += 1
      if (request.response) existingLeaf.responseCount += 1
      const existingIs2xx = is2xx(existingLeaf.request)
      const newIs2xx = is2xx(request)
      const shouldReplace =
        (!existingIs2xx && newIs2xx) ||
        (existingIs2xx === newIs2xx && request.id > existingLeaf.request.id)
      if (shouldReplace) {
        existingLeaf.request = request
        existingLeaf.id = `request:${request.id}`
      }
      continue
    }

    cursor.leaves.set(routeKey, {
      id: `request:${request.id}`,
      kind: 'request',
      request,
      occurrenceCount: 1,
      responseCount: request.response ? 1 : 0,
    })
  }

  function bubbleCounts(node: MutableBranchNode): { requestCount: number; responseCount: number } {
    let requestCount = node.leaves.size
    let responseCount = Array.from(node.leaves.values()).filter((leaf) => leaf.responseCount > 0).length

    for (const child of node.branches.values()) {
      const counts = bubbleCounts(child)
      requestCount += counts.requestCount
      responseCount += counts.responseCount
    }

    node.requestCount = requestCount
    node.responseCount = responseCount
    return { requestCount, responseCount }
  }

  for (const host of hosts.values()) {
    bubbleCounts(host)
  }

  return sortNodes(Array.from(hosts.values()).map(finalize)) as SitemapBranchNode[]
}

export function countUniqueRoutes(requests: Request[]): number {
  return new Set(requests.map((request) => `${request.scheme}://${request.host}${request.path || '/'}`)).size
}

export function getDefaultExpanded(tree: SitemapBranchNode[]): string[] {
  return tree.map((node) => node.id)
}

export function collectRequestIdsUnder(nodes: SitemapNode[]): number[] {
  const ids: number[] = []

  function visit(node: SitemapNode) {
    if (node.kind === 'request') {
      ids.push(node.request.id)
    } else {
      for (const child of node.children) visit(child)
    }
  }

  for (const node of nodes) visit(node)
  return ids
}

export function collectBranchIds(nodes: SitemapBranchNode[]): Set<string> {
  const ids = new Set<string>()

  function visit(node: SitemapBranchNode) {
    ids.add(node.id)
    for (const child of node.children) {
      if (child.kind !== 'request') visit(child)
    }
  }

  for (const node of nodes) visit(node)
  return ids
}
