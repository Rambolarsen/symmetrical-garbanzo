import { useReducer, useCallback } from 'react'
import type { Task, ColumnId, PrePlanningResult, PlanningResult } from '../types'

type Action =
  | { type: 'ADD'; task: Task }
  | { type: 'UPDATE'; id: string; title: string }
  | { type: 'MOVE'; id: string; column: ColumnId }
  | { type: 'SET_LOADING'; id: string; loading: boolean }
  | { type: 'SET_ERROR'; id: string; error: string }
  | { type: 'SET_PRE_PLANNING'; id: string; result: PrePlanningResult }
  | { type: 'SET_PLANNING'; id: string; result: PlanningResult }

function reducer(tasks: Task[], action: Action): Task[] {
  switch (action.type) {
    case 'ADD':
      return [...tasks, action.task]
    case 'UPDATE':
      return tasks.map(task => {
        if (task.id !== action.id) return task

        if (task.title === action.title) {
          return { ...task, title: action.title }
        }

        return {
          ...task,
          title: action.title,
          column: 'backlog',
          loading: false,
          error: undefined,
          prePlanningResult: undefined,
          planningResult: undefined,
        }
      })
    case 'MOVE':
      return tasks.map(t => t.id === action.id ? { ...t, column: action.column } : t)
    case 'SET_LOADING':
      return tasks.map(t => t.id === action.id ? { ...t, loading: action.loading } : t)
    case 'SET_ERROR':
      return tasks.map(t => t.id === action.id ? { ...t, error: action.error, loading: false } : t)
    case 'SET_PRE_PLANNING':
      return tasks.map(t => t.id === action.id ? { ...t, prePlanningResult: action.result, loading: false } : t)
    case 'SET_PLANNING':
      return tasks.map(t => t.id === action.id ? { ...t, planningResult: action.result, loading: false } : t)
  }
}

export function useTasks() {
  const [tasks, dispatch] = useReducer(reducer, [])

  const addTask = useCallback((title: string): Task => {
    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      column: 'backlog',
      loading: false,
      createdAt: new Date().toISOString(),
    }
    dispatch({ type: 'ADD', task })
    return task
  }, [])

  const moveTask = useCallback((id: string, column: ColumnId) =>
    dispatch({ type: 'MOVE', id, column }), [])

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

  return { tasks, addTask, updateTask, moveTask, setLoading, setError, setPrePlanning, setPlanning }
}
