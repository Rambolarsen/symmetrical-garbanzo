import type { Task } from '../types'

interface Props {
  task: Task
  onApprove: () => void
  onSkipPlanning: () => void
  onCancel: () => void
  onClose: () => void
  loading: boolean
}

const SEVERITY_COLOR: Record<string, string> = {
  low:      'text-green-400 border-green-800',
  medium:   'text-yellow-400 border-yellow-800',
  high:     'text-orange-400 border-orange-800',
  critical: 'text-red-400 border-red-800',
}

export function DecisionGateModal({ task, onApprove, onSkipPlanning, onCancel, onClose, loading }: Props) {
  const pre = task.prePlanningResult
  if (!pre) return null

  const barFill = Math.round(pre.complexityScore / 5)
  const bar = '█'.repeat(barFill) + '░'.repeat(20 - barFill)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-amber-900 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-amber-300 font-medium uppercase tracking-wide">Decision Gate</p>
            <h2 className="text-white font-semibold mt-0.5 leading-snug">{task.title}</h2>
          </div>
          <button onClick={onClose} className="text-amber-300 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">

          {/* Complexity */}
          <div>
            <p className="text-xs text-slate-400 mb-1">{pre.isTaskCoherent ? 'Complexity' : 'Task quality'}</p>
            {pre.isTaskCoherent ? (
              <>
                <p className="font-mono text-sm text-slate-200">{bar} {pre.complexityScore}/100</p>
                <p className="text-xs text-slate-400 mt-0.5 capitalize">{pre.complexityLevel} · {pre.estimatedHours}h · ${pre.estimatedCost.toFixed(2)}</p>
              </>
            ) : (
              <>
                <p className="text-sm text-amber-300">Needs clarification before scoring</p>
                <p className="text-xs text-slate-400 mt-0.5">{pre.coherenceNotes}</p>
              </>
            )}
          </div>

          {/* Planning recommendation */}
          <div className={`rounded-lg px-3 py-2 text-sm ${!pre.isTaskCoherent ? 'bg-amber-900/40 text-amber-300' : pre.requiresPlanning ? 'bg-red-900/40 text-red-300' : pre.recommendsPlanning ? 'bg-yellow-900/40 text-yellow-300' : 'bg-green-900/40 text-green-300'}`}>
            {!pre.isTaskCoherent
              ? 'Clarify the task before planning or execution'
              : pre.requiresPlanning
              ? '⚠ Planning required — complexity too high to skip safely'
              : pre.recommendsPlanning
              ? '→ Planning recommended — but you can skip if you know the domain'
              : '✓ Planning optional — straightforward task'}
          </div>

          {/* Score rationale */}
          {(pre.scoreRationale || pre.coherenceNotes) && (
            <div>
              <p className="text-xs text-slate-400 mb-1">{pre.isTaskCoherent ? 'Why this score' : 'Why this was not scored'}</p>
              <div className="text-xs text-slate-300 bg-slate-700 rounded px-3 py-2">
                {pre.isTaskCoherent ? pre.scoreRationale : pre.coherenceNotes}
              </div>
            </div>
          )}

          {/* Score breakdown */}
          {pre.scoreBreakdown.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 mb-1">Score breakdown</p>
              <div className="space-y-1">
                {pre.scoreBreakdown.map((factor, i) => (
                  <div key={i} className="text-xs bg-slate-700 rounded px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-200">{factor.description}</span>
                      <span className="text-slate-400 font-mono">{factor.score}</span>
                    </div>
                    <p className="text-slate-400 mt-0.5">{factor.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Risks */}
          {pre.risks.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 mb-1">Risks</p>
              <div className="space-y-1">
                {pre.risks.map((r, i) => (
                  <div key={i} className={`text-xs border rounded px-2 py-1.5 ${SEVERITY_COLOR[r.severity] ?? 'text-slate-400 border-slate-600'}`}>
                    <span className="font-medium uppercase">[{r.severity}]</span> {r.description}
                    <p className="text-slate-400 mt-0.5">→ {r.mitigation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Success criteria */}
          {pre.successCriteria.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 mb-1">Success criteria</p>
              <ul className="space-y-0.5">
                {pre.successCriteria.map((c, i) => (
                  <li key={i} className="text-xs text-slate-300">• {c}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommended agents */}
          {pre.recommendedAgents.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 mb-1">Recommended agents</p>
              <div className="space-y-1">
                {pre.recommendedAgents.map((a, i) => (
                  <div key={i} className="text-xs bg-slate-700 rounded px-2 py-1.5">
                    <span className="text-slate-200 font-medium">{a.name}</span>
                    <p className="text-slate-400 mt-0.5">{a.instructions}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-slate-700 flex gap-2 flex-wrap">
          <button
            onClick={onApprove}
            disabled={loading || !pre.isTaskCoherent}
            className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {loading ? 'Planning…' : '✓ Approve — Run Planning'}
          </button>
          <button
            onClick={onSkipPlanning}
            disabled={loading || !pre.isTaskCoherent}
            className="flex-1 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            → Skip Planning
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="bg-slate-700 hover:bg-red-900 disabled:opacity-50 text-slate-300 text-sm rounded-lg px-4 py-2 transition-colors"
          >
            ✕ Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
