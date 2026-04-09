import { useState, useEffect } from 'react'
import { parseSpec, reconstructSpec } from '../lib/specUtils'

interface Props {
  mode?: 'create' | 'edit'
  initialValue?: string
  initialSpec?: string
  projectPrefix?: string  // e.g. "## Project\n\n**Name**\nSource"
  onSubmit: (title: string, spec: string) => void
  onClose: () => void
}

export function AddTaskModal({
  mode = 'create',
  initialValue = '',
  initialSpec,
  projectPrefix,
  onSubmit,
  onClose,
}: Props) {
  const extractPrompt = (spec: string | undefined) => {
    if (!spec) return ''
    const up = parseSpec(spec).find(s => s.heading === 'User Prompt')
    return up?.content ?? spec.replace(/^##[^\n]*\n*/gm, '').trim()
  }

  const [title, setTitle] = useState(initialValue)
  const [userPrompt, setUserPrompt] = useState(() => extractPrompt(initialSpec) || initialValue)
  const [specTouched, setSpecTouched] = useState(!!initialSpec)

  useEffect(() => {
    setTitle(initialValue)
    setUserPrompt(extractPrompt(initialSpec) || initialValue)
    setSpecTouched(!!initialSpec)
  }, [initialValue, initialSpec])

  // Keep prompt in sync with title until user manually edits it
  useEffect(() => {
    if (!specTouched) setUserPrompt(title)
  }, [title, specTouched])

  const submit = () => {
    const t = title.trim()
    if (!t) return

    let finalSpec: string
    const promptContent = userPrompt.trim() || t

    if (mode === 'edit' && initialSpec) {
      // Preserve AI-generated sections, only update User Prompt
      const sections = parseSpec(initialSpec)
      const upIdx = sections.findIndex(s => s.heading === 'User Prompt')
      if (upIdx !== -1) {
        sections[upIdx] = { ...sections[upIdx], content: promptContent }
      } else {
        sections.unshift({ heading: 'User Prompt', content: promptContent })
      }
      finalSpec = reconstructSpec(sections)
    } else {
      finalSpec = projectPrefix
        ? `${projectPrefix}\n\n## User Prompt\n\n${promptContent}`
        : `## User Prompt\n\n${promptContent}`
    }

    onSubmit(t, finalSpec)
    onClose()
  }

  const isEdit = mode === 'edit'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-white font-semibold">{isEdit ? 'Edit Task' : 'New Task'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              placeholder="e.g. Add OAuth2 login with Google"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Task Description</label>
            <textarea
              value={userPrompt}
              onChange={e => { setUserPrompt(e.target.value); setSpecTouched(true) }}
              rows={6}
              placeholder="Describe what you want to build in detail…"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
          {isEdit && (
            <p className="text-xs text-amber-300">
              Changing the title resets pre-planning and planning output and moves the task back to Backlog.
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-700 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm text-slate-400 hover:text-white px-4 py-2 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {isEdit ? 'Save Changes' : 'Add to Backlog'}
          </button>
        </div>
      </div>
    </div>
  )
}
