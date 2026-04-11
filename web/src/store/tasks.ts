import { useReducer, useCallback } from 'react'
import type { Task, ColumnId, PrePlanningResult, PlanningResult, ClarificationRequest, VerificationResult, PlanningProgress, TaskChatMessage } from '../types'
import { upsertClarificationsSection, upsertSpecSection } from '../lib/specUtils'

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
  | { type: 'SET_PLANNING_PROGRESS'; id: string; progress: PlanningProgress | undefined }
  | { type: 'APPEND_PLANNING_TRANSCRIPT'; id: string; text: string }
  | { type: 'APPEND_CHAT_MESSAGE'; id: string; message: TaskChatMessage }
  | { type: 'APPEND_CHAT_ASSISTANT_DELTA'; id: string; text: string }
  | { type: 'SET_CHAT_LOADING'; id: string; loading: boolean }
  | { type: 'SET_CHAT_ERROR'; id: string; error: string | undefined }
  | { type: 'SET_CHAT_PROGRESS'; id: string; progress: PlanningProgress | undefined }
  | { type: 'MARK_SPEC_DIRTY_FROM_CHAT'; id: string; dirty: boolean }
  | { type: 'APPLY_CHAT_CLARIFICATION'; id: string; clarification: string }

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
          planningProgress: undefined,
          planningTranscript: undefined,
          chatMessages: undefined,
          chatProgress: undefined,
          chatLoading: undefined,
          chatError: undefined,
          specDirtyFromChat: undefined,
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
      return tasks.map(t => t.id === action.id
        ? {
            ...t,
            loading: action.loading,
            planningProgress: action.loading ? undefined : t.planningProgress,
            planningTranscript: action.loading && (t.column === 'pre-planning' || t.column === 'planning') ? '' : t.planningTranscript,
          }
        : t)
    case 'SET_ERROR':
      return tasks.map(t => t.id === action.id ? { ...t, error: action.error, loading: false } : t)
    case 'SET_PRE_PLANNING':
      return tasks.map(t => t.id === action.id ? { ...t, prePlanningResult: action.result, planningProgress: undefined, loading: false, specDirtyFromChat: false } : t)
    case 'SET_PLANNING':
      return tasks.map(t => t.id === action.id ? { ...t, planningResult: action.result, planningProgress: undefined, loading: false, specDirtyFromChat: false } : t)
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
    case 'SET_PLANNING_PROGRESS':
      return tasks.map(t => t.id === action.id ? { ...t, planningProgress: action.progress } : t)
    case 'APPEND_PLANNING_TRANSCRIPT':
      return tasks.map(t => t.id === action.id
        ? { ...t, planningTranscript: (t.planningTranscript ?? '') + action.text }
        : t)
    case 'APPEND_CHAT_MESSAGE':
      return tasks.map(t => t.id === action.id
        ? { ...t, chatMessages: [...(t.chatMessages ?? []), action.message], chatError: undefined }
        : t)
    case 'APPEND_CHAT_ASSISTANT_DELTA':
      return tasks.map(t => {
        if (t.id !== action.id) return t

        const messages = [...(t.chatMessages ?? [])]
        const last = messages.at(-1)
        if (!last || last.role !== 'assistant') {
          messages.push({
            id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: action.text,
            createdAt: new Date().toISOString(),
          })
        } else {
          messages[messages.length - 1] = { ...last, content: last.content + action.text }
        }

        return { ...t, chatMessages: messages, chatError: undefined }
      })
    case 'SET_CHAT_LOADING':
      return tasks.map(t => t.id === action.id ? { ...t, chatLoading: action.loading, chatProgress: action.loading ? undefined : t.chatProgress } : t)
    case 'SET_CHAT_ERROR':
      return tasks.map(t => t.id === action.id ? { ...t, chatError: action.error, chatLoading: false } : t)
    case 'SET_CHAT_PROGRESS':
      return tasks.map(t => t.id === action.id ? { ...t, chatProgress: action.progress } : t)
    case 'MARK_SPEC_DIRTY_FROM_CHAT':
      return tasks.map(t => t.id === action.id ? { ...t, specDirtyFromChat: action.dirty } : t)
    case 'APPLY_CHAT_CLARIFICATION':
      return tasks.map(t => t.id === action.id
        ? {
            ...t,
            spec: upsertClarificationsSection(t.spec ?? '', action.clarification),
            specDirtyFromChat: true,
            chatError: undefined,
          }
        : t)
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

  const setPlanningProgress = useCallback((id: string, progress: PlanningProgress | undefined) =>
    dispatch({ type: 'SET_PLANNING_PROGRESS', id, progress }), [])

  const appendPlanningTranscript = useCallback((id: string, text: string) =>
    dispatch({ type: 'APPEND_PLANNING_TRANSCRIPT', id, text }), [])

  const appendChatMessage = useCallback((id: string, message: TaskChatMessage) =>
    dispatch({ type: 'APPEND_CHAT_MESSAGE', id, message }), [])

  const appendChatAssistantDelta = useCallback((id: string, text: string) =>
    dispatch({ type: 'APPEND_CHAT_ASSISTANT_DELTA', id, text }), [])

  const setChatLoading = useCallback((id: string, loading: boolean) =>
    dispatch({ type: 'SET_CHAT_LOADING', id, loading }), [])

  const setChatError = useCallback((id: string, error: string | undefined) =>
    dispatch({ type: 'SET_CHAT_ERROR', id, error }), [])

  const setChatProgress = useCallback((id: string, progress: PlanningProgress | undefined) =>
    dispatch({ type: 'SET_CHAT_PROGRESS', id, progress }), [])

  const markSpecDirtyFromChat = useCallback((id: string, dirty: boolean) =>
    dispatch({ type: 'MARK_SPEC_DIRTY_FROM_CHAT', id, dirty }), [])

  const applyChatClarification = useCallback((id: string, clarification: string) =>
    dispatch({ type: 'APPLY_CHAT_CLARIFICATION', id, clarification }), [])

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
    setPlanningProgress,
    appendPlanningTranscript,
    appendChatMessage,
    appendChatAssistantDelta,
    setChatLoading,
    setChatError,
    setChatProgress,
    markSpecDirtyFromChat,
    applyChatClarification,
  }
}
