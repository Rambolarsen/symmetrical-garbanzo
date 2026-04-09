import { useState } from 'react'
import type { Task, WBSElement } from '../types'

interface Props {
  task: Task
  onClose: () => void
  onStartDevelopment?: () => void
  onPromoteWorkPackages?: () => void
  onSplitToStandalone?: () => void
}

export function PlanningResultModal({ task, onClose, onStartDevelopment, onPromoteWorkPackages, onSplitToStandalone }: Props) {
  const plan = task.planningResult
  if (!plan) return null

  const workPackages = plan.wbs.elements.filter(e => e.isWorkPackage)
  const byId = new Map(plan.wbs.elements.map(element => [element.id, element]))
  const rootElements = plan.wbs.elements
    .filter(element => !element.parentId || !byId.has(element.parentId))
    .sort(compareElements)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-purple-900 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-purple-300 font-medium uppercase tracking-wide">Planning Result</p>
            <h2 className="text-white font-semibold mt-0.5 leading-snug">{task.title}</h2>
          </div>
          <button onClick={onClose} className="text-purple-300 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Body — two columns */}
        <div className="flex divide-x divide-slate-700" style={{ maxHeight: '65vh' }}>

          {/* Left — specification (persistent) */}
          <div className="w-2/5 flex-shrink-0 overflow-y-auto bg-slate-900/60 p-4">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Specification</p>
            {plan.specification
              ? <p className="text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap">{plan.specification}</p>
              : <p className="text-xs text-slate-600 italic">No specification generated.</p>
            }
          </div>

          {/* Right — plan details */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            {/* Summary */}
            <div>
              <p className="text-xs text-slate-400 mb-1">Summary</p>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Work packages" value={String(workPackages.length)} />
                <Stat label="Total hours" value={`${plan.wbs.totalEstimatedHours.toFixed(0)}h`} />
                <Stat label="Critical path" value={`${plan.wbs.criticalPathHours.toFixed(0)}h`} />
              </div>
              {plan.wbs.parallelOpportunities > 0 && (
                <p className="mt-1 text-xs text-green-400">
                  ↑ {plan.wbs.parallelOpportunities} parallel opportunities identified
                </p>
              )}
            </div>

            {/* Execution phases */}
            {plan.executionPlan.length > 0 && (
              <div>
                <p className="text-xs text-slate-400 mb-1">Execution phases</p>
                <div className="space-y-2">
                  {plan.executionPlan.map(phase => {
                    const phasePackages = phase.workPackageIds
                      .map(id => plan.wbs.elements.find(e => e.id === id))
                      .filter(Boolean) as typeof plan.wbs.elements
                    const phaseHours = phasePackages.reduce((sum, wp) => sum + (wp.estimatedHours ?? 0), 0)
                    return (
                      <div key={phase.phaseNumber} className="text-xs bg-slate-700 rounded px-3 py-2">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div>
                            <span className="text-slate-200 font-medium">Phase {phase.phaseNumber}: {phase.name}</span>
                            <span className="text-slate-400 ml-2">· {phaseHours.toFixed(0)}h</span>
                          </div>
                          {phase.canParallelize && (
                            <span className="text-green-400 shrink-0">⇶ parallel</span>
                          )}
                        </div>
                        <div className="space-y-0.5 border-t border-slate-600 pt-1.5">
                          {phasePackages.map(wp => (
                            <div key={wp.id} className="flex items-baseline gap-1.5 text-slate-300">
                              <span className="text-slate-500 font-mono shrink-0">{wp.id}</span>
                              <span className="flex-1">{wp.title}</span>
                              <span className="text-slate-400 shrink-0 font-mono">
                                {wp.estimatedHours != null ? `${wp.estimatedHours}h` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* WBS tree */}
            {plan.wbs.elements.length > 0 && (
              <div>
                <p className="text-xs text-slate-400 mb-1">WBS tree ({plan.wbs.elements.length} elements)</p>
                <div className="space-y-1">
                  {rootElements.map(element => (
                    <WBSTreeRow key={element.id} element={element} byId={byId} depth={0} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700 flex justify-end gap-2 flex-wrap">
          {onSplitToStandalone && (
            <button
              onClick={onSplitToStandalone}
              className="bg-amber-700 hover:bg-amber-600 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
              title="Detach this sub-task and promote it to a top-level task so it can spawn its own work packages"
            >
              Split to Standalone
            </button>
          )}
          {onPromoteWorkPackages && workPackages.length > 0 && (
            <button
              onClick={onPromoteWorkPackages}
              className="bg-purple-700 hover:bg-purple-600 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
              title="Create individual backlog cards for each work package"
            >
              Promote to Cards ({workPackages.length})
            </button>
          )}
          {onStartDevelopment && (
            <button
              onClick={onStartDevelopment}
              className="bg-green-700 hover:bg-green-600 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
            >
              Start Development →
            </button>
          )}
          <button
            onClick={onClose}
            className="bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {onStartDevelopment ? 'Review Later' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-700 rounded px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm font-mono text-slate-100 mt-0.5">{value}</p>
    </div>
  )
}

function compareElements(a: WBSElement, b: WBSElement): number {
  return a.id.localeCompare(b.id, undefined, { numeric: true })
}

function getChildElements(element: WBSElement, byId: Map<string, WBSElement>): WBSElement[] {
  return element.childrenIds
    .map(id => byId.get(id))
    .filter((child): child is WBSElement => !!child)
    .sort(compareElements)
}

function WBSTreeRow({
  element,
  byId,
  depth,
}: {
  element: WBSElement
  byId: Map<string, WBSElement>
  depth: number
}) {
  const [expanded, setExpanded] = useState(false)
  const children = getChildElements(element, byId)
  const hasChildren = children.length > 0
  const hasMeta = element.assignedAgent || element.deliverable || element.successCriteria.length > 0 || element.description
  const canExpand = hasChildren || hasMeta
  const paddingLeft = 12 + depth * 16

  return (
    <div className="text-xs bg-slate-700 rounded">
      <div className="flex items-start justify-between gap-2 px-3 py-2" style={{ paddingLeft }}>
        <div className="flex-1">
          <span className={`font-medium ${element.isWorkPackage ? 'text-slate-200' : 'text-slate-100'}`}>
            {element.id} — {element.title || 'Untitled'}
          </span>
          <span className="text-slate-400 ml-2">
            {element.estimatedHours != null ? `${element.estimatedHours}h` : ''}
            {!element.isWorkPackage ? ' · group' : ''}
            {element.assignedAgent?.name ? ` · ${element.assignedAgent.name}` : ''}
          </span>
        </div>
        {canExpand && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
          >
            {expanded ? '▲' : '▼'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-1.5 border-t border-slate-600 px-3 py-2" style={{ paddingLeft }}>
          {element.description && (
            <p className="text-slate-300"><span className="text-slate-500">Description:</span> {element.description}</p>
          )}
          {element.deliverable && (
            <p className="text-slate-300"><span className="text-slate-500">Deliverable:</span> {element.deliverable}</p>
          )}
          {element.assignedAgent?.instructions && (
            <p className="text-slate-300"><span className="text-slate-500">Agent instructions:</span> {element.assignedAgent.instructions}</p>
          )}
          {element.successCriteria.length > 0 && (
            <div>
              <p className="text-slate-500 mb-0.5">Success criteria:</p>
              <ul className="space-y-0.5">
                {element.successCriteria.map((c, i) => (
                  <li key={i} className="text-slate-300">• {c}</li>
                ))}
              </ul>
            </div>
          )}
          {children.length > 0 && (
            <div className="space-y-1">
              {children.map(child => (
                <WBSTreeRow key={child.id} element={child} byId={byId} depth={depth + 1} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
