import { useState, useCallback } from 'react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { COLUMNS } from '../types'
import type { Task, ColumnId } from '../types'
import { prePlan, plan } from '../api/client'
import { Column } from './Column'
import { DecisionGateModal } from './DecisionGateModal'
import { AddTaskModal } from './AddTaskModal'
import { useTasks } from '../store/tasks'

export function Board() {
  const { tasks, addTask, updateTask, moveTask, setLoading, setError, setPrePlanning, setPlanning } = useTasks()
  const [gateTask, setGateTask] = useState<Task | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [gateLoading, setGateLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 5000)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // ---------------------------------------------------------------------------
  // Drag handler — only valid transitions trigger actions
  // ---------------------------------------------------------------------------
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    console.log('[drag] end', { activeId: active.id, overId: over?.id })
    if (!over) { console.log('[drag] no drop target'); return }

    const taskId = active.id as string
    const targetCol = over.id as ColumnId
    const task = tasks.find(t => t.id === taskId)
    console.log('[drag] task:', task?.column, '→', targetCol)
    if (!task || task.column === targetCol || task.loading) { console.log('[drag] early return', { task: !!task, sameCol: task?.column === targetCol, loading: task?.loading }); return }

    // backlog → pre-planning
    if (task.column === 'backlog' && targetCol === 'pre-planning') {
      moveTask(taskId, 'pre-planning')
      setLoading(taskId, true)
      try {
        console.log('[pre-planning] calling API...')
        const result = await prePlan(task.title)
        setPrePlanning(taskId, result)
        moveTask(taskId, 'decision-gate')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[pre-planning] failed:', msg)
        setError(taskId, msg)
        moveTask(taskId, 'backlog')
        showToast(`Pre-planning failed: ${msg}`)
      }
      return
    }

    // in-development → done
    if (task.column === 'in-development' && targetCol === 'done') {
      moveTask(taskId, 'done')
      return
    }

    // All other drops are ignored (card snaps back)
  }, [tasks, moveTask, setLoading, setError, setPrePlanning, showToast])

  // ---------------------------------------------------------------------------
  // Decision gate actions
  // ---------------------------------------------------------------------------
  const handleGateApprove = useCallback(async () => {
    if (!gateTask) return
    setGateLoading(true)
    moveTask(gateTask.id, 'planning')
    setLoading(gateTask.id, true)
    setGateTask(null)
    try {
      const result = await plan(gateTask.title, gateTask.prePlanningResult!)
      setPlanning(gateTask.id, result)
      moveTask(gateTask.id, 'in-development')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(gateTask.id, msg)
      showToast(`Planning failed: ${msg}`)
    } finally {
      setGateLoading(false)
    }
  }, [gateTask, moveTask, setLoading, setError, setPlanning])

  const handleGateSkip = useCallback(() => {
    if (!gateTask) return
    moveTask(gateTask.id, 'in-development')
    setGateTask(null)
  }, [gateTask, moveTask])

  const handleGateCancel = useCallback(() => {
    if (!gateTask) return
    moveTask(gateTask.id, 'backlog')
    setGateTask(null)
  }, [gateTask, moveTask])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      {/* Topbar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-white tracking-tight">Maestroid</span>
          <span className="text-xs bg-slate-700 text-slate-300 rounded px-2 py-0.5">MVP</span>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
        >
          + New Task
        </button>
      </header>

      {/* Board */}
      <div className="flex-1 overflow-x-auto p-6">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 h-full min-w-max">
            {COLUMNS.map(col => (
              <Column
                key={col.id}
                id={col.id}
                label={col.label}
                accent={col.accent}
                headerBg={col.headerBg}
              tasks={tasks.filter(t => t.column === col.id)}
              onCardClick={col.id === 'decision-gate'
                  ? (task) => setGateTask(task)
                  : undefined}
              onEditTask={(task) => setEditTask(task)}
              />
            ))}
          </div>
        </DndContext>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-lg w-full px-4">
          <div className="bg-red-900 border border-red-700 text-red-200 text-sm rounded-xl px-4 py-3 shadow-2xl flex items-start gap-3">
            <span className="text-red-400 mt-0.5">⚠</span>
            <span className="flex-1 break-words">{toast}</span>
            <button onClick={() => setToast(null)} className="text-red-400 hover:text-white ml-2">×</button>
          </div>
        </div>
      )}

      {/* Modals */}
      {gateTask && (
        <DecisionGateModal
          task={gateTask}
          onApprove={handleGateApprove}
          onSkipPlanning={handleGateSkip}
          onCancel={handleGateCancel}
          onClose={() => setGateTask(null)}
          loading={gateLoading}
        />
      )}
      {showAdd && (
        <AddTaskModal
          onSubmit={(title) => addTask(title)}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editTask && (
        <AddTaskModal
          mode="edit"
          initialValue={editTask.title}
          onSubmit={(title) => updateTask(editTask.id, title)}
          onClose={() => setEditTask(null)}
        />
      )}
    </div>
  )
}
