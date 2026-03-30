import { useDroppable } from '@dnd-kit/core'
import type { Task } from '../types'
import { TaskCard } from './TaskCard'

interface Props {
  id: string
  label: string
  accent: string
  headerBg: string
  tasks: Task[]
  onCardClick?: (task: Task) => void
  onEditTask?: (task: Task) => void
}

export function Column({ id, label, accent, headerBg, tasks, onCardClick, onEditTask }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id })

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
      <div
        className="flex flex-col gap-2 p-2 flex-1 min-h-[120px]"
      >
        {tasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            onClick={onCardClick ? () => onCardClick(task) : undefined}
            onEdit={onEditTask ? () => onEditTask(task) : undefined}
          />
        ))}
      </div>
    </div>
  )
}
