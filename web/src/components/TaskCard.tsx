import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { Task } from '../types'
import { extractUserPrompt } from '../lib/specUtils'

interface Props {
  task: Task
  onClick?: () => void
  onEdit?: () => void
  onCancel?: () => void  // cancel in-flight analysis and return to backlog
  subTaskCount?: number  // number of promoted sub-tasks belonging to this card
  onPrePlanAll?: () => void  // pre-plan all eligible children at once
  onViewSpec?: () => void  // open full spec viewer
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

export function TaskCard({ task, onClick, onEdit, onCancel, subTaskCount = 0, onPrePlanAll, onViewSpec }: Props) {
  const [errorExpanded, setErrorExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  function copyError(e: React.MouseEvent) {
    e.stopPropagation()
    if (!task.error) return
    navigator.clipboard.writeText(task.error).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: task.loading,
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
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={[
        'rounded-lg p-3 bg-slate-700 border select-none',
        task.loading ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        task.error ? 'border-red-500'
          : task.column === 'pre-planning' && task.prePlanningResult && !task.loading ? 'border-blue-400 shadow-blue-900/40 shadow-md'
          : task.column === 'planning' && task.planningResult && !task.loading ? 'border-purple-400 shadow-purple-900/40 shadow-md'
          : 'border-slate-600',
        isDragging ? 'shadow-2xl' : 'shadow-sm',
      ].join(' ')}
    >
      {/* Relationship badges */}
      {(task.parentId || task.derivedFromId || subTaskCount > 0) && (
        <div className="mb-1.5 flex gap-1.5 flex-wrap">
          {task.parentId && (
            <span className="text-[10px] bg-purple-900/60 border border-purple-700 text-purple-300 rounded px-1.5 py-0.5 leading-none">
              ↳ sub-task
            </span>
          )}
          {task.derivedFromId && (
            <span className="text-[10px] bg-slate-600 border border-slate-500 text-slate-300 rounded px-1.5 py-0.5 leading-none">
              ↑ split from sub-task
            </span>
          )}
          {subTaskCount > 0 && (
            <span className="text-[10px] bg-slate-600 border border-slate-500 text-slate-300 rounded px-1.5 py-0.5 leading-none">
              {subTaskCount} sub-task{subTaskCount !== 1 ? 's' : ''}
            </span>
          )}
          {onPrePlanAll && (
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onPrePlanAll() }}
              className="text-[10px] bg-blue-900/60 border border-blue-700 text-blue-300 hover:text-blue-100 hover:border-blue-500 rounded px-1.5 py-0.5 leading-none transition-colors"
            >
              ⚡ Pre-plan all
            </button>
          )}
        </div>
      )}
      <div className="mb-2">
        <p className="text-sm font-medium text-slate-100 leading-snug">{task.title}</p>
      </div>

      {/* Loading */}
      {task.loading && (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <span className="inline-block w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="flex-1">
            {task.column === 'pre-planning' ? 'Analyzing complexity…'
              : task.column === 'planning' ? 'Building work breakdown…'
              : task.column === 'in-development' ? 'Executing planned work packages…'
              : task.column === 'verification' ? 'Verifying against criteria…'
              : 'Processing…'}
          </span>
          {onCancel && (
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onCancel() }}
              className="shrink-0 text-slate-500 hover:text-red-400 transition-colors leading-none"
              title="Cancel and return to backlog"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Pre-planning context while planning is running */}
      {task.loading && task.column === 'planning' && pre && (
        <>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className={`inline-block w-2 h-2 rounded-full ${COMPLEXITY_COLOR[pre.complexityLevel] ?? 'bg-slate-400'}`} />
            <span className="text-xs text-slate-300">{pre.complexityScore}/100</span>
            <span className="text-xs text-slate-400">{pre.complexityLevel}</span>
            <span className="ml-auto text-xs text-slate-400">{pre.estimatedHours}h</span>
          </div>
          {pre.risks.length > 0 && (
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
        </>
      )}

      {/* Error */}
      {task.error && !task.loading && (
        <div className="mt-2 bg-red-950/50 border border-red-800 rounded px-2 py-1.5 select-text">
          <p className={`text-xs text-red-300 font-mono whitespace-pre-wrap break-all leading-relaxed ${errorExpanded ? '' : 'line-clamp-3'}`}>
            {task.error}
          </p>
          <div className="flex gap-3 mt-1.5">
            {task.error.length > 120 && (
              <button
                type="button"
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); setErrorExpanded(v => !v) }}
                className="text-[11px] text-red-400 hover:text-red-200 transition-colors"
              >
                {errorExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={copyError}
              className="text-[11px] text-red-400 hover:text-red-200 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Spec preview — strip markdown headers, show body text */}
      {task.spec && !task.loading && (
        <p className={`mt-2 text-xs text-slate-300 leading-snug ${task.column === 'backlog' ? 'line-clamp-2 text-slate-400' : 'line-clamp-3'}`}>
          {extractUserPrompt(task.spec).slice(0, 300)}
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
        </div>
      )}

      {/* Clarification badge — agent is waiting for human input */}
      {task.pendingClarification && !task.loading && (
        <div className="mt-2 rounded border border-amber-700 bg-amber-900/30 px-2 py-1.5">
          <p className="text-xs text-amber-300 font-medium">⏸ Waiting for your input</p>
          <p className="text-xs text-amber-400 mt-0.5 line-clamp-2">{task.pendingClarification.question}</p>
        </div>
      )}

      {/* Execution output snippet — shown while agent is running */}
      {task.executionOutput && task.column === 'in-development' && !task.pendingClarification && (
        <p className="mt-2 text-xs text-slate-400 font-mono line-clamp-2 leading-relaxed">
          {task.executionOutput.slice(-200)}
        </p>
      )}

      {/* Verification result badge */}
      {task.verificationResult && !task.loading && (
        <div className={`mt-2 rounded border px-2 py-1.5 ${
          task.verificationResult.overallPassed
            ? 'border-green-700 bg-green-900/20'
            : 'border-red-700 bg-red-900/20'
        }`}>
          <p className={`text-xs font-medium ${task.verificationResult.overallPassed ? 'text-green-400' : 'text-red-400'}`}>
            {task.verificationResult.overallPassed ? '✓ All criteria passed' : `✗ ${task.verificationResult.criteriaChecks.filter(c => !c.passed).length} criteria failed`}
          </p>
          {task.column === 'verification' && (
            <p className="text-xs text-slate-400 mt-0.5">Click to review →</p>
          )}
        </div>
      )}


{/* Pre-planning complete hint */}
      {task.column === 'pre-planning' && task.prePlanningResult && !task.loading && (
        <p className="mt-2 text-xs text-blue-400">Click to review →</p>
      )}

      {/* Plan review hint */}
      {(task.column === 'planning' || task.column === 'in-development' || task.column === 'done') && task.planningResult && !task.loading && (
        <p className="mt-2 text-xs text-purple-400">Click to review plan →</p>
      )}

      {/* Footer actions */}
      {!task.loading && (onEdit || onViewSpec) && (
        <div className="mt-2 pt-2 border-t border-slate-600/60 flex items-center gap-1">
          {onEdit && (
            <button
              type="button"
              title="Edit task"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onEdit() }}
              className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-600 transition-colors"
              aria-label="Edit task"
            >
              {/* Pencil icon */}
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}
          {onViewSpec && (
            <button
              type="button"
              title="View full specification"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onViewSpec() }}
              className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-600 transition-colors"
              aria-label="View full specification"
            >
              {/* Document icon */}
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
