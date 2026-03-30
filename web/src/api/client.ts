import type { PrePlanningResult, PlanningResult } from '../types'

const BASE = '/api'

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    // Extract first line only — avoids dumping the full .NET stack trace into the UI
    const firstLine = text.split('\n')[0].trim()
    throw new Error(firstLine || `HTTP ${res.status}`)
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
    scoreBreakdown: raw.scoreBreakdown ?? [],
    risks: raw.risks ?? [],
    constraints: raw.constraints ?? [],
    assumptions: raw.assumptions ?? [],
    successCriteria: raw.successCriteria ?? [],
    recommendedAgents: raw.recommendedAgents ?? [],
  }
}

export function prePlan(task: string): Promise<PrePlanningResult> {
  return post<any>('/orchestration/pre-plan', { task }).then(normalizePrePlanningResult)
}

export function plan(task: string, prePlanning: PrePlanningResult): Promise<PlanningResult> {
  return post('/orchestration/plan', { task, prePlanning })
}
