import { useState } from 'react'
import type { ProjectContext } from '../types'
import { loadRepoContext, pickFolder } from '../api/client'

interface Props {
  initial?: ProjectContext
  onSave: (ctx: ProjectContext) => void
  onClose?: () => void
}

function detectSourceType(source: string): 'github' | 'local' | null {
  if (!source.trim()) return null
  if (source.trim().startsWith('https://github.com/')) return 'github'
  return 'local'
}

export function ProjectSetupModal({ initial, onSave, onClose }: Props) {
  const [source, setSource] = useState(initial?.source ?? '')
  const [githubToken, setGithubToken] = useState(initial?.githubToken ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [generatedContext, setGeneratedContext] = useState(initial?.generatedContext ?? '')
  const [loading, setLoading] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sourceType = detectSourceType(source)
  const contextLoaded = generatedContext.length > 0
  const canLoad = sourceType !== null && !loading
  const canSave = contextLoaded && name.trim().length > 0

  async function handlePickFolder() {
    setPicking(true)
    setError(null)
    try {
      const result = await pickFolder()
      setSource(result.path)
      setGeneratedContext('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // "No folder selected" means the user cancelled the picker — show nothing
      if (msg !== 'No folder selected') setError(msg)
    } finally {
      setPicking(false)
    }
  }

  async function handleLoad() {
    if (!canLoad) return
    setLoading(true)
    setError(null)
    setGeneratedContext('')
    try {
      const result = await loadRepoContext(source.trim(), githubToken.trim() || undefined)
      setGeneratedContext(result.generatedContext)
      if (!name.trim()) setName(result.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return
    onSave({
      name: name.trim(),
      source: source.trim(),
      githubToken: githubToken.trim() || undefined,
      generatedContext,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-blue-900 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-blue-300 font-medium uppercase tracking-wide">
              {initial ? 'Edit Project' : 'Set Up Project'}
            </p>
            <h2 className="text-white font-semibold mt-0.5">
              {initial ? 'Update project source' : 'Point to your codebase'}
            </h2>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-blue-300 hover:text-white text-xl leading-none">×</button>
          )}
        </div>

        <form onSubmit={handleSave} className="px-5 py-4 space-y-3">

          {/* Source input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-400">Repository or folder</label>
              {sourceType && (
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                  sourceType === 'github'
                    ? 'bg-purple-900 text-purple-300'
                    : 'bg-slate-700 text-slate-300'
                }`}>
                  {sourceType === 'github' ? 'GitHub' : 'Local'}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={source}
                onChange={e => { setSource(e.target.value); setGeneratedContext(''); setError(null) }}
                placeholder="https://github.com/owner/repo  or  /Users/me/workspace/myapp"
                className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                autoFocus
              />
              <button
                type="button"
                onClick={handlePickFolder}
                disabled={picking}
                title="Browse for folder"
                className="shrink-0 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 border border-slate-600 text-slate-300 hover:text-white rounded-lg px-3 py-2 text-sm transition-colors"
              >
                {picking ? '…' : '📁'}
              </button>
            </div>
          </div>

          {/* GitHub PAT — shown only for GitHub sources */}
          {sourceType === 'github' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Personal access token <span className="text-slate-500">(required for private repos)</span></label>
              <input
                type="password"
                value={githubToken}
                onChange={e => setGithubToken(e.target.value)}
                placeholder="ghp_..."
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
          )}

          {/* Load button */}
          <button
            type="button"
            onClick={handleLoad}
            disabled={!canLoad}
            className="w-full bg-slate-600 hover:bg-slate-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Loading context…
              </>
            ) : (
              contextLoaded ? '↻ Reload context' : '→ Load context'
            )}
          </button>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400 bg-red-900/30 border border-red-800 rounded px-3 py-2">{error}</p>
          )}

          {/* Preview */}
          {contextLoaded && (
            <>
              <div>
                <p className="text-xs text-slate-400 mb-1">Extracted context <span className="text-slate-500">(passed to AI on every task)</span></p>
                <pre className="text-xs text-slate-300 bg-slate-900 border border-slate-700 rounded px-3 py-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
                  {generatedContext}
                </pre>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Project name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={!canSave}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                >
                  {initial ? 'Save changes' : 'Start working'}
                </button>
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg px-4 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
