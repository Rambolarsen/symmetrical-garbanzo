import { useState, useEffect, useRef, useCallback } from 'react'
import { getModels, updateModels } from '../api/client'
import type { ModelConfig } from '../api/client'

function shortName(model: string): string {
  if (model.startsWith('claude-')) {
    const m = model.replace(/^claude-/, '').replace(/-\d{10,}$/, '')
    const tier = m.split('-')[0]
    return tier.charAt(0).toUpperCase() + tier.slice(1)
  }
  return model
}

function providerGroup(model: string): 'Claude' | 'OpenAI' | 'Local' {
  if (model.startsWith('claude-')) return 'Claude'
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'OpenAI'
  return 'Local'
}

export function ModelSelector() {
  const [config, setConfig] = useState<ModelConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      setConfig(await getModels())
    } catch { /* backend not ready yet */ }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function handleChange(tier: 'fast' | 'balanced', model: string) {
    if (!config) return
    setSaving(true)
    try {
      const updated = await updateModels({ [tier]: model })
      setConfig(updated)
    } finally {
      setSaving(false)
    }
  }

  if (!config) return null

  const groups = {
    Claude: config.available.filter(m => providerGroup(m) === 'Claude'),
    OpenAI: config.available.filter(m => providerGroup(m) === 'OpenAI'),
    Local:  config.available.filter(m => providerGroup(m) === 'Local'),
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-slate-700/60 transition-colors"
        title="Model selection"
      >
        <span className="text-xs text-slate-400">Models</span>
        <span className="text-xs text-slate-500">▾</span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg p-3 w-64 shadow-xl text-xs">
          <div className="text-slate-500 mb-2 font-medium uppercase tracking-wide text-[10px]">Active Models</div>

          {(['fast', 'balanced'] as const).map(tier => (
            <div key={tier} className="mb-2 last:mb-0">
              <label className="text-slate-400 block mb-1 capitalize">{tier}</label>
              <select
                value={config[tier]}
                disabled={saving}
                onChange={e => handleChange(tier, e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-slate-400 disabled:opacity-50"
              >
                {(Object.entries(groups) as [string, string[]][])
                  .filter(([, models]) => models.length > 0)
                  .map(([group, models]) => (
                    <optgroup key={group} label={group}>
                      {models.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </optgroup>
                  ))}
              </select>
              <div className="text-slate-500 mt-0.5 truncate">→ {shortName(config[tier])}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
