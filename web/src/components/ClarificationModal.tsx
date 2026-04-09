import { useState } from 'react'
import type { ClarificationRequest } from '../types'

interface Props {
  taskTitle: string
  request: ClarificationRequest
  onSubmit: (answer: string) => void
  loading: boolean
}

export function ClarificationModal({ taskTitle, request, onSubmit, loading }: Props) {
  const [freeText, setFreeText] = useState('')
  const [selectedOption, setSelectedOption] = useState<string | null>(null)

  const hasOptions = request.options && request.options.length > 0
  const answer = hasOptions ? (selectedOption ?? '') : freeText.trim()
  const canSubmit = !loading && answer.length > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (canSubmit) onSubmit(answer)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-amber-900 px-5 py-4">
          <p className="text-xs text-amber-300 font-medium uppercase tracking-wide">Agent needs clarification</p>
          <h2 className="text-white font-semibold mt-0.5 leading-snug">{taskTitle}</h2>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 space-y-4">

            {/* Question */}
            <div className="bg-amber-900/20 border border-amber-800 rounded-lg px-4 py-3">
              <p className="text-xs text-amber-400 font-medium mb-1">Question</p>
              <p className="text-slate-100 text-sm leading-relaxed">{request.question}</p>
            </div>

            {/* Context */}
            {request.context && (
              <div>
                <p className="text-xs text-slate-400 mb-1">Context</p>
                <p className="text-xs text-slate-300 leading-relaxed">{request.context}</p>
              </div>
            )}

            {/* Options or free-text */}
            {hasOptions ? (
              <div>
                <p className="text-xs text-slate-400 mb-2">Choose an option</p>
                <div className="space-y-2">
                  {request.options!.map((opt, i) => (
                    <label
                      key={i}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                        selectedOption === opt
                          ? 'border-amber-500 bg-amber-900/20 text-amber-200'
                          : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <input
                        type="radio"
                        name="clarification-option"
                        value={opt}
                        checked={selectedOption === opt}
                        onChange={() => setSelectedOption(opt)}
                        className="accent-amber-400"
                      />
                      <span className="text-sm">{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs text-slate-400 mb-1">Your answer</p>
                <textarea
                  autoFocus
                  rows={3}
                  value={freeText}
                  onChange={e => setFreeText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e as any) }}
                  placeholder="Type your answer…"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none focus:border-amber-500 transition-colors"
                />
                <p className="text-xs text-slate-500 mt-1">⌘↵ to submit</p>
              </div>
            )}

          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-slate-700 flex justify-end">
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-1.5 text-sm rounded-lg bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Sending…' : 'Send answer →'}
            </button>
          </div>
        </form>

      </div>
    </div>
  )
}
