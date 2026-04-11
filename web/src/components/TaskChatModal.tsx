import { useEffect, useMemo, useRef, useState } from 'react'
import type { Task, TaskChatMessage } from '../types'
import { extractClarificationDraft } from '../lib/specUtils'

interface Props {
  task: Task
  onClose: () => void
  onSend: (message: string) => void
  onApplyClarification: (clarification: string) => void
  onRerun?: () => void
}

function shortModelName(model: string): string {
  if (model.startsWith('claude-')) {
    const normalized = model.replace(/^claude-/, '').replace(/-\d{10,}$/, '')
    const [tier] = normalized.split('-')
    return tier.charAt(0).toUpperCase() + tier.slice(1)
  }
  return model
}

function getRerunLabel(task: Task): string | null {
  if (task.column === 'pre-planning') return 'Run Pre-Planning Again'
  if (task.column === 'planning') return 'Run Planning Again'
  return null
}

export function TaskChatModal({ task, onClose, onSend, onApplyClarification, onRerun }: Props) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const messages = task.chatMessages ?? []
  const progress = task.chatProgress
  const rerunLabel = getRerunLabel(task)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, task.chatLoading])

  const canSend = !task.chatLoading && draft.trim().length > 0
  const contextLabel = useMemo(() => task.column === 'pre-planning' ? 'Pre-Planning Spec Chat' : 'Planning Spec Chat', [task.column])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSend) return
    onSend(draft.trim())
    setDraft('')
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm p-4">
      <div className="mx-auto my-4 bg-slate-800 border border-slate-600 rounded-lg w-full max-w-5xl shadow-2xl overflow-hidden">
        <div className="bg-slate-900 px-5 py-4 flex items-start justify-between gap-4 border-b border-slate-700">
          <div className="min-w-0">
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{contextLabel}</p>
            <h2 className="text-white font-semibold mt-0.5 leading-snug truncate">{task.title}</h2>
            <div className="mt-1 flex gap-2 flex-wrap text-xs text-slate-400">
              <span>{task.column}</span>
              {progress?.tier && <span>{progress.tier}</span>}
              {progress?.model && <span>{shortModelName(progress.model)}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">x</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] divide-y lg:divide-y-0 lg:divide-x divide-slate-700" style={{ minHeight: '60vh' }}>
          <div className="flex flex-col min-h-0">
            <div ref={scrollRef} className="flex-1 overflow-y-auto bg-slate-950 p-4 space-y-3 min-h-0">
              {messages.length === 0 && (
                <div className="text-sm text-slate-500">
                  Ask the model to comment on the spec, identify gaps, or propose clarification text you can apply.
                </div>
              )}

              {messages.map(message => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  onApplyClarification={onApplyClarification}
                />
              ))}

              {task.chatLoading && (
                <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-400">
                  {progress?.message ?? 'Thinking…'}
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="border-t border-slate-700 bg-slate-900/80 p-4 space-y-2">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={3}
                placeholder="Comment on the spec, ask for a clarification draft, or answer the model’s questions…"
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500 transition-colors"
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e)
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">Cmd/Ctrl+Enter to send</p>
                <button
                  type="submit"
                  disabled={!canSend}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                >
                  {task.chatLoading ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
          </div>

          <div className="bg-slate-900/80 p-4 space-y-4 overflow-y-auto">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Current Status</p>
              <p className="text-sm text-slate-200">{progress?.message ?? 'Ready to discuss the spec.'}</p>
            </div>

            {task.chatError && (
              <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2">
                <p className="text-xs text-red-300 break-words">{task.chatError}</p>
              </div>
            )}

            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Spec Updates</p>
              <p className="text-sm text-slate-300">
                {task.specDirtyFromChat
                  ? 'Clarifications were applied to the spec. Re-run this phase when ready.'
                  : 'No applied clarifications yet.'}
              </p>
            </div>

            {rerunLabel && onRerun && (
              <button
                onClick={onRerun}
                disabled={task.loading || !task.specDirtyFromChat}
                className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
              >
                {rerunLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ChatBubble({
  message,
  onApplyClarification,
}: {
  message: TaskChatMessage
  onApplyClarification: (clarification: string) => void
}) {
  const draft = message.role === 'assistant' ? extractClarificationDraft(message.content) : null

  return (
    <div className={`rounded-lg border px-3 py-2 ${message.role === 'assistant' ? 'border-slate-700 bg-slate-900' : 'border-blue-800 bg-blue-950/40'}`}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className={`text-xs font-medium uppercase tracking-wide ${message.role === 'assistant' ? 'text-slate-400' : 'text-blue-300'}`}>
          {message.role === 'assistant' ? 'Model' : 'You'}
        </span>
        <span className="text-[11px] text-slate-500">{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <pre className="text-sm text-slate-100 whitespace-pre-wrap break-words font-sans">{message.content}</pre>
      {draft && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => onApplyClarification(draft)}
            className="bg-purple-700 hover:bg-purple-600 text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
          >
            Apply To Spec
          </button>
        </div>
      )}
    </div>
  )
}
