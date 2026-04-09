import type { Task } from '../types'

interface Props {
  task: Task
  onApprove: () => void
  onReject: () => void
  onClose: () => void
  loading: boolean
}

const CONFIDENCE_LABEL = (c: number) => {
  if (c >= 0.8) return 'high confidence'
  if (c >= 0.5) return 'medium confidence'
  return 'low confidence'
}

const CONFIDENCE_COLOR = (c: number) => {
  if (c >= 0.8) return 'text-green-400'
  if (c >= 0.5) return 'text-yellow-400'
  return 'text-slate-400'
}

export function VerificationModal({ task, onApprove, onReject, onClose, loading }: Props) {
  const v = task.verificationResult
  if (!v) return null

  const passed = v.criteriaChecks.filter(c => c.passed).length
  const total = v.criteriaChecks.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-teal-900 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-teal-300 font-medium uppercase tracking-wide">Verification</p>
            <h2 className="text-white font-semibold mt-0.5 leading-snug">{task.title}</h2>
          </div>
          <button onClick={onClose} className="text-teal-300 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">

          {/* Overall result */}
          <div className={`rounded-lg px-4 py-3 border text-sm ${
            v.overallPassed
              ? 'bg-green-900/30 border-green-700 text-green-300'
              : 'bg-red-900/30 border-red-700 text-red-300'
          }`}>
            <p className="font-semibold">
              {v.overallPassed ? '✓ All criteria passed' : `✗ ${total - passed} of ${total} criteria failed`}
            </p>
            <p className="text-xs mt-1 opacity-80">{v.summary}</p>
          </div>

          {/* Criteria checks */}
          {v.criteriaChecks.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 mb-2">Criteria ({passed}/{total} passed)</p>
              <div className="space-y-2">
                {v.criteriaChecks.map((check, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border px-3 py-2.5 text-sm ${
                      check.passed
                        ? 'bg-slate-700/50 border-green-800'
                        : 'bg-slate-700/50 border-red-800'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 shrink-0 ${check.passed ? 'text-green-400' : 'text-red-400'}`}>
                        {check.passed ? '✓' : '✗'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-200 leading-snug">{check.criterion}</p>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">{check.evidence}</p>
                        <p className={`text-xs mt-1 ${CONFIDENCE_COLOR(check.confidence)}`}>
                          {CONFIDENCE_LABEL(check.confidence)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {v.recommendations && v.recommendations.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 mb-2">Recommendations</p>
              <ul className="space-y-1">
                {v.recommendations.map((r, i) => (
                  <li key={i} className="text-xs text-slate-300 flex gap-1.5">
                    <span className="text-amber-400 shrink-0">→</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700 flex gap-2 justify-end">
          <button
            onClick={onReject}
            disabled={loading}
            className="px-4 py-1.5 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50 transition-colors"
          >
            ✗ Send back to development
          </button>
          <button
            onClick={onApprove}
            disabled={loading}
            className="px-4 py-1.5 text-sm rounded-lg bg-teal-700 hover:bg-teal-600 text-white disabled:opacity-50 transition-colors"
          >
            ✓ Mark as done
          </button>
        </div>

      </div>
    </div>
  )
}
