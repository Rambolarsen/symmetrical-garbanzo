import type {
  PrePlanningResult,
  PlanningResult,
  VerificationResult,
  ClarificationRequest,
  ExecutionStreamEvent,
} from '../types'

const BASE = '/api'

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

function normalizePrePlanningResult(raw: any): PrePlanningResult {
  return {
    scopeId: raw.scopeId,
    isTaskCoherent: raw.isTaskCoherent ?? true,
    coherenceNotes: raw.coherenceNotes ?? '',
    complexityScore: raw.complexityScore ?? 0,
    complexityLevel: raw.complexityLevel ?? 'trivial',
    requiresPlanning: raw.requiresPlanning ?? false,
    recommendsPlanning: raw.recommendsPlanning ?? false,
    estimatedHours: raw.estimatedHours ?? 0,
    estimatedCost: raw.estimatedCost ?? raw.estimatedCostUsd ?? 0,
    scoreRationale: raw.scoreRationale ?? '',
    specification: raw.specification ?? '',
    scoreBreakdown: raw.scoreBreakdown ?? [],
    risks: raw.risks ?? [],
    constraints: raw.constraints ?? [],
    assumptions: raw.assumptions ?? [],
    successCriteria: raw.successCriteria ?? [],
    recommendedAgents: raw.recommendedAgents ?? [],
  }
}

export interface OllamaStartResult {
  started: boolean
  message: string
}

export async function startOllama(): Promise<OllamaStartResult> {
  let res: Response
  try {
    res = await fetch(`${BASE}/health/ollama/start`, { method: 'POST' })
  } catch {
    throw new Error('Could not reach the backend — is the API server running?')
  }

  let data: OllamaStartResult
  try {
    data = await res.json()
  } catch {
    throw new Error(`Backend returned a non-JSON response (HTTP ${res.status})`)
  }

  // 409 (already running) and 202 (already starting) are not errors
  if (!res.ok && res.status !== 409 && res.status !== 202) {
    throw new Error(data.message ?? `HTTP ${res.status}`)
  }
  return data
}

export async function pickFolder(): Promise<{ path: string }> {
  const r = await fetch(`${BASE}/orchestration/pick-folder`)
  if (!r.ok) {
    let msg = 'No folder selected'
    try {
      const body = await r.json()
      msg = body?.detail ?? body?.title ?? body?.message ?? msg
    } catch { /* ignore parse error */ }
    throw new Error(msg)
  }
  return r.json()
}

export function loadRepoContext(source: string, githubToken?: string): Promise<{ name: string; generatedContext: string }> {
  return post('/orchestration/repo-context', { source, githubToken })
}

export function loadSerenaContext(projectPath: string, task: string, signal?: AbortSignal): Promise<string | null> {
  return post<{ context?: string | null }>('/orchestration/serena-context', { projectPath, task }, signal)
    .then(result => result.context ?? null)
}

export function prePlan(spec: string, context: string, signal?: AbortSignal): Promise<PrePlanningResult> {
  return post<any>('/orchestration/pre-plan', { task: spec, context }, signal).then(normalizePrePlanningResult)
}

export function plan(spec: string, prePlanning: PrePlanningResult, context: string, projectPath?: string, signal?: AbortSignal): Promise<PlanningResult> {
  return post('/orchestration/plan', { task: spec, prePlanning, context, projectPath }, signal)
}

// ---------------------------------------------------------------------------
// Execution streaming
// ---------------------------------------------------------------------------

export interface StreamExecutionOptions {
  task: string
  roleName: string
  roleInstructions: string
  workingDirectory?: string
  allowedTools?: string[]
  permissionMode?: string
  enableClarification?: boolean
}

export interface StreamExecutionHandlers {
  onProgress: (message: string) => void
  onToolCall: (toolName: string, inputPreview: string) => void
  onClarification: (request: ClarificationRequest) => void
  onComplete: (output: string, cost: number, durationMs: number) => void
  onError: (message: string) => void
}

/**
 * Starts a streaming execution via POST /api/orchestration/execute.
 * Returns an abort function — call it to cancel the stream.
 *
 * Uses fetch + ReadableStream instead of EventSource because EventSource
 * only supports GET requests.
 */
export function streamExecution(
  options: StreamExecutionOptions,
  handlers: StreamExecutionHandlers
): () => void {
  const controller = new AbortController()

  ;(async () => {
    let response: Response

    try {
      response = await fetch(`${BASE}/orchestration/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: options.task,
          roleName: options.roleName,
          roleInstructions: options.roleInstructions,
          workingDirectory: options.workingDirectory,
          allowedTools: options.allowedTools,
          permissionMode: options.permissionMode ?? 'default',
          enableClarification: options.enableClarification ?? true,
        }),
        signal: controller.signal,
      })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        handlers.onError((err as Error).message ?? 'Network error')
      }
      return
    }

    if (!response.ok) {
      const text = await response.text()
      handlers.onError(text || `HTTP ${response.status}`)
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      handlers.onError('No response body')
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // SSE lines are separated by \n — each data line is "data: {...}\n"
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // keep partial last line

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue

          const jsonStr = trimmed.slice('data:'.length).trim()
          if (!jsonStr) continue

          let event: ExecutionStreamEvent
          try {
            event = JSON.parse(jsonStr)
          } catch {
            continue
          }

          switch (event.type) {
            case 'progress':
              handlers.onProgress(event.message)
              break
            case 'tool_call':
              handlers.onToolCall(event.toolName, event.inputPreview)
              break
            case 'clarification_needed':
              handlers.onClarification({
                requestId: event.requestId,
                question: event.question,
                context: event.context,
                options: event.options,
              })
              break
            case 'complete':
              handlers.onComplete(event.output, event.cost, event.durationMs)
              break
            case 'error':
              handlers.onError(event.message)
              break
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        handlers.onError((err as Error).message ?? 'Stream read error')
      }
    } finally {
      reader.releaseLock()
    }
  })()

  return () => controller.abort()
}

/**
 * Sends a human clarification answer to unblock a paused agent.
 */
export function sendClarification(requestId: string, answer: string): Promise<{ ok: boolean }> {
  return post(`/orchestration/clarify/${requestId}`, { answer })
}

/**
 * Runs LLM verification of execution output against success criteria.
 */
export function verify(
  taskTitle: string,
  successCriteria: string[],
  executionOutput: string
): Promise<VerificationResult> {
  return post('/orchestration/verify', { taskTitle, successCriteria, executionOutput })
}
