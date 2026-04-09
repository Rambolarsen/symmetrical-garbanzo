import { useReducer, useCallback } from 'react'
import type { Task, ColumnId, PrePlanningResult, PlanningResult, ClarificationRequest, VerificationResult } from '../types'
import { upsertSpecSection } from '../lib/specUtils'

type Action =
  | { type: 'ADD'; task: Task }
  | { type: 'UPDATE'; id: string; title: string }
  | { type: 'REMOVE'; id: string }
  | { type: 'MOVE'; id: string; column: ColumnId }
  | { type: 'START_EXECUTION'; id: string }
  | { type: 'SET_LOADING'; id: string; loading: boolean }
  | { type: 'SET_ERROR'; id: string; error: string }
  | { type: 'SET_PRE_PLANNING'; id: string; result: PrePlanningResult }
  | { type: 'SET_PLANNING'; id: string; result: PlanningResult }
  | { type: 'APPEND_EXECUTION_OUTPUT'; id: string; chunk: string }
  | { type: 'SET_CLARIFICATION'; id: string; request: ClarificationRequest }
  | { type: 'CLEAR_CLARIFICATION'; id: string }
  | { type: 'SET_VERIFICATION'; id: string; result: VerificationResult }
  | { type: 'SET_SPEC'; id: string; spec: string }
  | { type: 'UPSERT_SPEC_SECTION'; id: string; section: string }
  | { type: 'SET_DERIVED_FROM'; id: string; derivedFromId: string }

function reducer(tasks: Task[], action: Action): Task[] {
  switch (action.type) {
    case 'ADD':
      return [...tasks, action.task]
    case 'REMOVE':
      return tasks.filter(t => t.id !== action.id)
    case 'UPDATE':
      return tasks.map(task => {
        if (task.id !== action.id) return task

        if (task.title === action.title) {
          return { ...task, title: action.title }
        }

        return {
          ...task,
          title: action.title,
          spec: `## User Prompt\n\n${action.title}`,
          column: 'backlog',
          loading: false,
          error: undefined,
          prePlanningResult: undefined,
          planningResult: undefined,
          executionOutput: undefined,
          pendingClarification: undefined,
          verificationResult: undefined,
        }
      })
    case 'MOVE':
      return tasks.map(t => t.id === action.id ? { ...t, column: action.column } : t)
    case 'START_EXECUTION':
      return tasks.map(t => t.id === action.id
        ? {
            ...t,
            loading: true,
            error: undefined,
            executionOutput: '',
            pendingClarification: undefined,
            verificationResult: undefined,
          }
        : t)
    case 'SET_LOADING':
      return tasks.map(t => t.id === action.id ? { ...t, loading: action.loading } : t)
    case 'SET_ERROR':
      return tasks.map(t => t.id === action.id ? { ...t, error: action.error, loading: false } : t)
    case 'SET_PRE_PLANNING':
      return tasks.map(t => t.id === action.id ? { ...t, prePlanningResult: action.result, loading: false } : t)
    case 'SET_PLANNING':
      return tasks.map(t => t.id === action.id ? { ...t, planningResult: action.result, loading: false } : t)
    case 'APPEND_EXECUTION_OUTPUT':
      return tasks.map(t => t.id === action.id
        ? { ...t, executionOutput: (t.executionOutput ?? '') + action.chunk }
        : t)
    case 'SET_CLARIFICATION':
      return tasks.map(t => t.id === action.id
        ? { ...t, pendingClarification: action.request, loading: false }
        : t)
    case 'CLEAR_CLARIFICATION':
      return tasks.map(t => t.id === action.id
        ? { ...t, pendingClarification: undefined }
        : t)
    case 'SET_VERIFICATION':
      return tasks.map(t => t.id === action.id
        ? { ...t, verificationResult: action.result, loading: false }
        : t)
    case 'SET_SPEC':
      return tasks.map(t => t.id === action.id ? { ...t, spec: action.spec } : t)
    case 'UPSERT_SPEC_SECTION':
      return tasks.map(t => t.id === action.id
        ? { ...t, spec: upsertSpecSection(t.spec ?? '', action.section) }
        : t)
    case 'SET_DERIVED_FROM':
      return tasks.map(t => t.id === action.id ? { ...t, derivedFromId: action.derivedFromId } : t)
  }
}

export function useTasks() {
  const [tasks, dispatch] = useReducer(reducer, [])

  const addTask = useCallback((title: string, spec?: string, parentId?: string): Task => {
    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      spec: spec || `## User Prompt\n\n${title}`,
      ...(parentId ? { parentId } : {}),
      column: 'backlog',
      loading: false,
      createdAt: new Date().toISOString(),
    }
    dispatch({ type: 'ADD', task })
    return task
  }, [])

  const moveTask = useCallback((id: string, column: ColumnId) =>
    dispatch({ type: 'MOVE', id, column }), [])

  const startExecution = useCallback((id: string) =>
    dispatch({ type: 'START_EXECUTION', id }), [])

  const updateTask = useCallback((id: string, title: string) =>
    dispatch({ type: 'UPDATE', id, title: title.trim() }), [])

  const setLoading = useCallback((id: string, loading: boolean) =>
    dispatch({ type: 'SET_LOADING', id, loading }), [])

  const setError = useCallback((id: string, error: string) =>
    dispatch({ type: 'SET_ERROR', id, error }), [])

  const setPrePlanning = useCallback((id: string, result: PrePlanningResult) =>
    dispatch({ type: 'SET_PRE_PLANNING', id, result }), [])

  const setPlanning = useCallback((id: string, result: PlanningResult) =>
    dispatch({ type: 'SET_PLANNING', id, result }), [])

  const appendExecutionOutput = useCallback((id: string, chunk: string) =>
    dispatch({ type: 'APPEND_EXECUTION_OUTPUT', id, chunk }), [])

  const setClarification = useCallback((id: string, request: ClarificationRequest) =>
    dispatch({ type: 'SET_CLARIFICATION', id, request }), [])

  const clearClarification = useCallback((id: string) =>
    dispatch({ type: 'CLEAR_CLARIFICATION', id }), [])

  const setVerification = useCallback((id: string, result: VerificationResult) =>
    dispatch({ type: 'SET_VERIFICATION', id, result }), [])

  const setSpec = useCallback((id: string, spec: string) =>
    dispatch({ type: 'SET_SPEC', id, spec }), [])

  const upsertSpec = useCallback((id: string, section: string) =>
    dispatch({ type: 'UPSERT_SPEC_SECTION', id, section }), [])

  const removeTask = useCallback((id: string) =>
    dispatch({ type: 'REMOVE', id }), [])

  const setDerivedFrom = useCallback((id: string, derivedFromId: string) =>
    dispatch({ type: 'SET_DERIVED_FROM', id, derivedFromId }), [])

  return {
    tasks,
    addTask, updateTask, moveTask, removeTask,
    startExecution,
    setLoading, setError,
    setPrePlanning, setPlanning,
    appendExecutionOutput,
    setClarification, clearClarification,
    setVerification,
    setSpec, upsertSpec, setDerivedFrom,
  }
}
