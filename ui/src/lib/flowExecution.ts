import { api } from '@/api/client'
import type { Flow } from '@/api/client'

export interface StepResult {
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  response?: any
  error?: string
  extractedVars?: Record<string, string>
}

export interface FlowRunState {
  stepResults: Record<string, StepResult>
  variables: Record<string, string>
  status: 'idle' | 'running' | 'done' | 'error'
  currentStepId: string | null
}

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

async function pollReplayResult(id: number, signal: AbortSignal): Promise<any> {
  const start = Date.now()
  while (!signal.aborted) {
    const result = await api.replay.get(id)
    if (result.status === 'done' || result.response_id != null) {
      return result
    }
    if (Date.now() - start > 30000) throw new Error('Replay timeout')
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('Aborted')
}

export async function runProcessStep(
  code: string,
  response: any | null,
  variables: Record<string, string>
): Promise<{ variables: Record<string, string>; error?: string }> {
  const result = await api.flows.exec({
    code,
    response: response
      ? {
          status: response.response?.status_code ?? 0,
          headers: response.response?.headers ? (() => {
            try { return JSON.parse(response.response.headers) } catch { return {} }
          })() : {},
          body:
            typeof response.response?.body === 'string'
              ? response.response.body
              : '',
        }
      : { status: 0, headers: {}, body: '' },
    variables,
  })
  return result
}

export async function executeFlow(
  flow: Flow,
  seedVars: Record<string, string>,
  onProgress: (state: FlowRunState) => void,
  signal: AbortSignal
): Promise<FlowRunState> {
  let variables = { ...(flow.variables ?? {}), ...seedVars }
  const stepResults: Record<string, StepResult> = {}

  for (const step of flow.steps) {
    stepResults[step.id] = { status: 'pending' }
  }

  const emit = (status: FlowRunState['status'], currentStepId: string | null) => {
    onProgress({
      stepResults: { ...stepResults },
      variables: { ...variables },
      status,
      currentStepId,
    })
  }

  emit('running', null)

  let lastResponse: any = null

  for (const step of flow.steps) {
    if (signal.aborted) break

    stepResults[step.id] = { status: 'running' }
    emit('running', step.id)

    try {
      if (step.type === 'request') {
        const rawDecoded = atob(step.raw ?? '')
        const interpolated = interpolate(rawDecoded, variables)
        const replayResp = await fetch('/api/replay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: 0, raw: btoa(interpolated) }),
          signal,
        })
        if (!replayResp.ok) {
          throw new Error(`Replay failed: ${await replayResp.text()}`)
        }
        const replayData = await replayResp.json()
        const result = await pollReplayResult(replayData.id, signal)
        lastResponse = result
        stepResults[step.id] = { status: 'done', response: result }
      } else if (step.type === 'process') {
        const returned = await runProcessStep(step.code ?? '', lastResponse, variables)
        if (returned.error) throw new Error(returned.error)
        variables = { ...variables, ...(returned.variables ?? {}) }
        stepResults[step.id] = { status: 'done', extractedVars: returned.variables }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        stepResults[step.id] = { status: 'skipped' }
        break
      }
      stepResults[step.id] = { status: 'error', error: err?.message ?? String(err) }
      emit('error', step.id)
      return {
        stepResults: { ...stepResults },
        variables,
        status: 'error',
        currentStepId: step.id,
      }
    }

    emit('running', step.id)
  }

  const finalStatus: FlowRunState['status'] = signal.aborted ? 'error' : 'done'
  const finalState: FlowRunState = {
    stepResults: { ...stepResults },
    variables,
    status: finalStatus,
    currentStepId: null,
  }
  onProgress(finalState)
  return finalState
}
