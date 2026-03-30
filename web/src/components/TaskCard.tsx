import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { Task } from '../types'

interface Props {
  task: Task
  onClick?: () => void
  onEdit?: () => void
}

const COMPLEXITY_COLOR: Record<string, string> = {
  trivial:    'bg-green-500',
  simple:     'bg-green-400',
  moderate:   'bg-yellow-400',
  complex:    'bg-orange-500',
  enterprise: 'bg-red-500',
}

const SEVERITY_COLOR: Record<string, string> = {
  low:      'text-green-400',
  medium:   'text-yellow-400',
  high:     'text-orange-400',
  critical: 'text-red-400',
}

export function TaskCard({ task, onClick, onEdit }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: task.loading || task.column === 'decision-gate',
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  const pre = task.prePlanningResult

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(task.column !== 'decision-gate' ? { ...listeners, ...attributes } : {})}
      onClick={onClick}
      className={[
        'rounded-lg p-3 bg-slate-700 border border-slate-600 select-none',
        task.column === 'decision-gate' ? 'cursor-pointer hover:border-amber-400 transition-colors' : 'cursor-grab active:cursor-grabbing',
        task.error ? 'border-red-500' : '',
        isDragging ? 'shadow-2xl' : 'shadow-sm',
      ].join(' ')}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-100 leading-snug flex-1">{task.title}</p>
        {onEdit && !task.loading && (
          <button
            type="button"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              onEdit()
            }}
            className="shrink-0 rounded-md border border-slate-500 px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-300 hover:text-white transition-colors"
            aria-label={`Edit task ${task.title}`}
          >
            Edit
          </button>
        )}
      </div>

      {/* Loading */}
      {task.loading && (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <span className="inline-block w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
          Processing…
        </div>
      )}

      {/* Error */}
      {task.error && !task.loading && (
        <p className="mt-1 text-xs text-red-400 truncate" title={task.error}>
          ⚠ {task.error}
        </p>
      )}

      {/* Pre-planning summary */}
      {pre && !task.loading && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className={`inline-block w-2 h-2 rounded-full ${COMPLEXITY_COLOR[pre.complexityLevel] ?? 'bg-slate-400'}`} />
          {pre.isTaskCoherent ? (
            <>
              <span className="text-xs text-slate-300">{pre.complexityScore}/100</span>
              <span className="text-xs text-slate-400">{pre.complexityLevel}</span>
              <span className="ml-auto text-xs text-slate-400">{pre.estimatedHours}h</span>
            </>
          ) : (
            <span className="text-xs text-amber-300">Needs clarification</span>
          )}
        </div>
      )}

      {/* Risk pills */}
      {pre && pre.risks.length > 0 && !task.loading && (
        <div className="mt-1 flex gap-1 flex-wrap">
          {pre.risks.slice(0, 3).map((r, i) => (
            <span key={i} className={`text-xs ${SEVERITY_COLOR[r.severity]}`}>
              [{r.severity}]
            </span>
          ))}
          {pre.risks.length > 3 && (
            <span className="text-xs text-slate-500">+{pre.risks.length - 3}</span>
          )}
        </div>
      )}

      {/* Planning summary */}
      {task.planningResult && !task.loading && (
        <div className="mt-2 text-xs text-slate-400">
          <span>{task.planningResult.wbs.elements.filter(e => e.isWorkPackage).length} work packages</span>
          <span className="mx-1">·</span>
          <span>{task.planningResult.wbs.totalEstimatedHours.toFixed(0)}h</span>
          <span className="mx-1">·</span>
          <span>${task.planningResult.wbs.totalEstimatedCost.toFixed(2)}</span>
        </div>
      )}

      {/* Decision gate hint */}
      {task.column === 'decision-gate' && !task.loading && (
        <p className="mt-2 text-xs text-amber-400">Click to review →</p>
      )}
    </div>
  )
}
