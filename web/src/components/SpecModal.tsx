import { useState } from 'react'
import type { Task } from '../types'
import { parseSpec, reconstructSpec, type SpecSection } from '../lib/specUtils'

interface Props {
  task: Task
  onSave: (spec: string) => void
  onClose: () => void
}

const AI_SECTIONS = new Set([
  'Pre-Planning Analysis',
  'Planning Specification',
  'Parent Task',
  'Work Package',
])

export function SpecModal({ task, onSave, onClose }: Props) {
  const [draftSections, setDraftSections] = useState<SpecSection[]>(() => parseSpec(task.spec))

  function handleUserPromptChange(value: string) {
    setDraftSections(prev =>
      prev.map(s => s.heading === 'User Prompt' ? { ...s, content: value } : s)
    )
  }

  function handleSave() {
    onSave(reconstructSpec(draftSections))
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">

        {/* Header */}
        <div className="bg-slate-700 px-5 py-4 flex items-center justify-between shrink-0">
          <div>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">
              Specification
            </p>
            <h2 className="text-white font-semibold mt-0.5 leading-snug">{task.title}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
          {draftSections.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No spec yet.</p>
          ) : (
            draftSections.map((section, i) => (
              <div key={i} className="border border-slate-700 rounded-lg overflow-hidden">
                {/* Section heading row */}
                {section.heading && (
                  <div className="bg-slate-700/50 px-4 py-2 flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                      {section.heading}
                    </span>
                    {AI_SECTIONS.has(section.heading) && (
                      <span className="text-[10px] bg-purple-900/60 border border-purple-700 text-purple-300 rounded px-1.5 py-0.5 leading-none">
                        AI
                      </span>
                    )}
                  </div>
                )}

                {/* Section content */}
                {section.heading === 'User Prompt' ? (
                  <textarea
                    value={section.content}
                    onChange={e => handleUserPromptChange(e.target.value)}
                    rows={6}
                    className="w-full bg-slate-900/50 border-t border-slate-700 px-4 py-3 text-sm text-slate-100 resize-y focus:outline-none focus:bg-slate-900 placeholder-slate-500 transition-colors"
                    placeholder="Describe what you want to build…"
                  />
                ) : (
                  <div className="px-4 py-3">
                    <SpecContent content={section.content} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700 flex justify-end gap-2 shrink-0">
          <button
            onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            Save
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

function SpecContent({ content }: { content: string }) {
  if (!content) {
    return <p className="text-sm text-slate-500 italic">No content</p>
  }
  const lines = content.split('\n')
  return (
    <div className="space-y-0.5 text-sm text-slate-300 leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) {
          return <p key={i} className="text-slate-200 font-semibold mt-2">{line.slice(4)}</p>
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <p key={i} className="flex gap-2">
              <span className="text-slate-500 shrink-0">•</span>
              <span>{renderInline(line.slice(2))}</span>
            </p>
          )
        }
        if (line.trim() === '') {
          return <div key={i} className="h-1.5" />
        }
        return <p key={i}>{renderInline(line)}</p>
      })}
    </div>
  )
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i} className="text-slate-100 font-medium">{part.slice(2, -2)}</strong>
          : part
      )}
    </>
  )
}
