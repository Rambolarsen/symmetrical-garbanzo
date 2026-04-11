import { useDroppable } from '@dnd-kit/core'
import type { Task } from '../types'
import { TaskCard } from './TaskCard'

interface Props {
  id: string
  label: string
  accent: string
  headerBg: string
  tasks: Task[]
  allTasks?: Task[]  // full task list for computing sub-task counts
  onCardClick?: (task: Task) => void
  onEditTask?: (task: Task) => void
  onChatTask?: (task: Task) => void
  canChatTask?: (task: Task) => boolean
  onDebugTask?: (task: Task) => void
  canDebugTask?: (task: Task) => boolean
  onPrePlanAll?: (children: Task[]) => void
  onCancelTask?: (task: Task) => void
  onViewSpec?: (task: Task) => void
}

export function Column({ id, label, accent, headerBg, tasks, allTasks = [], onCardClick, onEditTask, onChatTask, canChatTask, onDebugTask, canDebugTask, onPrePlanAll, onCancelTask, onViewSpec }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id })

  // Group children under their parent when both are in this column
  const columnTaskIds = new Set(tasks.map(t => t.id))

  const childIdsInColumn = new Set(
    tasks.filter(t => t.parentId && columnTaskIds.has(t.parentId)).map(t => t.id)
  )

  const topLevel = tasks.filter(t => !childIdsInColumn.has(t.id))

  const childrenByParent = new Map<string, Task[]>()
  tasks.forEach(t => {
    if (t.parentId && columnTaskIds.has(t.parentId)) {
      const list = childrenByParent.get(t.parentId) ?? []
      list.push(t)
      childrenByParent.set(t.parentId, list)
    }
  })

  return (
    <div
      ref={setNodeRef}
      className={[
        'flex flex-col w-64 shrink-0 rounded-xl border-t-2 bg-slate-800',
        accent,
        isOver ? 'ring-2 ring-white/20' : '',
      ].join(' ')}
    >
      {/* Header */}
      <div className={`${headerBg} rounded-t-xl px-3 py-2 flex items-center justify-between`}>
        <span className="text-sm font-semibold text-white">{label}</span>
        <span className="text-xs bg-black/30 text-white rounded-full px-2 py-0.5">
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 p-2 flex-1 min-h-[120px]">
        {topLevel.map(task => {
          const children = childrenByParent.get(task.id) ?? []
          return (
            <div key={task.id}>
              <TaskCard
                task={task}
                subTaskCount={allTasks.filter(t => t.parentId === task.id).length}
                onClick={onCardClick ? () => onCardClick(task) : undefined}
                onEdit={onEditTask ? () => onEditTask(task) : undefined}
                onChat={onChatTask && (canChatTask?.(task) ?? true) ? () => onChatTask(task) : undefined}
                onDebug={onDebugTask && (canDebugTask?.(task) ?? true) ? () => onDebugTask(task) : undefined}
                onCancel={onCancelTask && task.loading ? () => onCancelTask(task) : undefined}
                onViewSpec={onViewSpec ? () => onViewSpec(task) : undefined}
                onPrePlanAll={(() => {
                  if (!onPrePlanAll || children.length === 0) return undefined
                  const eligible = children.filter(c => c.column === 'backlog' && !c.prePlanningResult && !c.loading)
                  return eligible.length > 0 ? () => onPrePlanAll(eligible) : undefined
                })()}
              />
              {children.length > 0 && (
                <div className="ml-3 mt-1 space-y-1 border-l-2 border-slate-600 pl-2">
                  {children.map(child => (
                    <TaskCard
                      key={child.id}
                      task={child}
                      subTaskCount={0}
                      onClick={onCardClick ? () => onCardClick(child) : undefined}
                      onEdit={onEditTask ? () => onEditTask(child) : undefined}
                      onChat={onChatTask && (canChatTask?.(child) ?? true) ? () => onChatTask(child) : undefined}
                      onDebug={onDebugTask && (canDebugTask?.(child) ?? true) ? () => onDebugTask(child) : undefined}
                      onCancel={onCancelTask && child.loading ? () => onCancelTask(child) : undefined}
                      onViewSpec={onViewSpec ? () => onViewSpec(child) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
