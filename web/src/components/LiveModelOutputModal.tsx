import { useEffect, useRef } from 'react'
import type { Task } from '../types'

interface Props {
  task: Task
  onClose: () => void
}

function shortModelName(model: string): string {
  if (model.startsWith('claude-')) {
    const normalized = model.replace(/^claude-/, '').replace(/-\d{10,}$/, '')
    const [tier] = normalized.split('-')
    return tier.charAt(0).toUpperCase() + tier.slice(1)
  }
  return model
}

function phaseLabel(task: Task): string {
  return task.column === 'pre-planning' ? 'Pre-planning'
    : task.column === 'planning' ? 'Planning'
    : 'Model run'
}

export function LiveModelOutputModal({ task, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const progress = task.planningProgress
  const transcript = task.planningTranscript ?? ''

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [transcript])

  function copyTranscript() {
    void navigator.clipboard.writeText(transcript)
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm p-4">
      <div className="mx-auto my-4 bg-slate-800 border border-slate-600 rounded-lg w-full max-w-5xl shadow-2xl overflow-hidden">
        <div className="bg-slate-900 px-5 py-4 flex items-start justify-between gap-4 border-b border-slate-700">
          <div className="min-w-0">
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Live Model Output</p>
            <h2 className="text-white font-semibold mt-0.5 leading-snug truncate">{task.title}</h2>
            <div className="mt-1 flex gap-2 flex-wrap text-xs text-slate-400">
              <span>{phaseLabel(task)}</span>
              {progress?.tier && <span>{progress.tier}</span>}
              {progress?.model && <span>{shortModelName(progress.model)}</span>}
              {progress?.elapsedMs != null && <span>{Math.floor(progress.elapsedMs / 1000)}s</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">x</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] divide-y lg:divide-y-0 lg:divide-x divide-slate-700">
          <div ref={scrollRef} className="overflow-y-auto bg-slate-950 p-4">
            {transcript ? (
              <pre className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap break-words font-mono">{transcript}</pre>
            ) : (
              <p className="text-sm text-slate-500">Waiting for model output...</p>
            )}
          </div>

          <div className="bg-slate-900/80 p-4 space-y-4 overflow-y-auto">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Status</p>
              <p className="text-sm text-slate-200">{progress?.message ?? 'Starting model request...'}</p>
            </div>

            {progress?.attempt && progress.maxAttempts && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Attempt</p>
                <p className="text-sm text-slate-200 font-mono">{progress.attempt}/{progress.maxAttempts}</p>
              </div>
            )}

            {progress?.issues && progress.issues.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Retry Issues</p>
                <ul className="space-y-1">
                  {progress.issues.map((issue, index) => (
                    <li key={index} className="text-xs text-slate-300 break-words">- {issue}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Transcript</p>
              <p className="text-xs text-slate-400">{transcript.length.toLocaleString()} characters</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-700 flex justify-end gap-2">
          <button
            onClick={copyTranscript}
            disabled={!transcript}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg px-4 py-2 transition-colors"
          >
            Copy Transcript
          </button>
          <button
            onClick={onClose}
            className="bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
