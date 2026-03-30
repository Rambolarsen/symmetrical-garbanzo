import { useState } from 'react'
import { useEffect } from 'react'

interface Props {
  mode?: 'create' | 'edit'
  initialValue?: string
  onSubmit: (title: string) => void
  onClose: () => void
}

export function AddTaskModal({
  mode = 'create',
  initialValue = '',
  onSubmit,
  onClose,
}: Props) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  const submit = () => {
    const title = value.trim()
    if (title) {
      onSubmit(title)
      onClose()
    }
  }

  const isEdit = mode === 'edit'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-white font-semibold">{isEdit ? 'Edit Task' : 'New Task'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Describe what you want to build</label>
            <textarea
              autoFocus
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && e.metaKey && submit()}
              rows={3}
              placeholder="e.g. Add OAuth2 login with Google to the web app"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">⌘↵ to submit</p>
          </div>
          {isEdit && (
            <p className="text-xs text-amber-300">
              Changing the task resets any pre-planning and planning output and moves it back to Backlog.
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
            disabled={!value.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {isEdit ? 'Save Changes' : 'Add to Backlog'}
          </button>
        </div>
      </div>
    </div>
  )
}
