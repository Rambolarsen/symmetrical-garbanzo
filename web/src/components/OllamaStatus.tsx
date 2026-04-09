import { useState, useEffect, useCallback, useRef } from 'react'
import { startOllama } from '../api/client'

interface OllamaHealth {
  up: boolean
  host: string
  models?: string[]
  error?: string
}

const MAX_AUTO_START_ATTEMPTS = 2
const START_POLL_INTERVAL_MS = 2000
const START_POLL_MAX_ATTEMPTS = 15  // 30s total

export function OllamaStatus() {
  const [health, setHealth] = useState<OllamaHealth | null>(null)
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const startPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoStartAttemptsRef = useRef(0)

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/health/ollama')
      const data: OllamaHealth = await res.json()
      setHealth(data)
      return data
    } catch {
      const data: OllamaHealth = { up: false, host: 'http://localhost:11434', error: 'Unreachable' }
      setHealth(data)
      return data
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await check()
    setRefreshing(false)
  }, [check])

  // Attempt to start Ollama, then poll until it's up or we give up.
  // Returns true if Ollama came up, false otherwise.
  const tryStart = useCallback(async (): Promise<boolean> => {
    try {
      await startOllama()
    } catch {
      return false
    }

    return new Promise<boolean>(resolve => {
      let attempts = 0
      startPollRef.current = setInterval(async () => {
        attempts++
        const data = await check()
        if (data.up) {
          clearInterval(startPollRef.current!)
          startPollRef.current = null
          resolve(true)
        } else if (attempts >= START_POLL_MAX_ATTEMPTS) {
          clearInterval(startPollRef.current!)
          startPollRef.current = null
          resolve(false)
        }
      }, START_POLL_INTERVAL_MS)
    })
  }, [check])

  // Clear fast-poll and starting state as soon as Ollama comes up
  useEffect(() => {
    if (health?.up && startPollRef.current) {
      clearInterval(startPollRef.current)
      startPollRef.current = null
      setStarting(false)
      setStartError(null)
    }
  }, [health?.up])

  // On mount: check, and if down auto-start up to MAX_AUTO_START_ATTEMPTS times
  useEffect(() => {
    async function autoStart() {
      const initial = await check()
      if (initial.up) return

      for (let i = 0; i < MAX_AUTO_START_ATTEMPTS; i++) {
        autoStartAttemptsRef.current = i + 1
        setStarting(true)
        setStartError(null)
        const up = await tryStart()
        if (up) {
          setStarting(false)
          return
        }
      }

      setStarting(false)
      setStartError(`Ollama didn't respond after ${MAX_AUTO_START_ATTEMPTS} start attempt(s). Try manually.`)
    }

    autoStart()
    const id = setInterval(check, 30_000)
    return () => {
      clearInterval(id)
      if (startPollRef.current) clearInterval(startPollRef.current)
    }
  }, [check, tryStart])

  // Click-outside to close
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleStart = useCallback(async () => {
    setStarting(true)
    setStartError(null)
    const up = await tryStart()
    setStarting(false)
    if (!up) setStartError('Ollama did not respond within 30s. Try refreshing.')
  }, [tryStart])

  if (!health) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-slate-700/60 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full ${
          health.up  ? 'bg-emerald-400' :
          starting   ? 'bg-amber-400 animate-pulse' :
                       'bg-red-500'
        }`} />
        <span className="text-xs text-slate-400">Ollama</span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg p-3 w-56 shadow-xl text-xs">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                health.up  ? 'bg-emerald-400' :
                starting   ? 'bg-amber-400 animate-pulse' :
                             'bg-red-500'
              }`} />
              <span className={`font-medium ${
                health.up  ? 'text-emerald-400' :
                starting   ? 'text-amber-400' :
                             'text-red-400'
              }`}>
                {health.up ? 'Running' : starting ? 'Starting…' : 'Offline'}
              </span>
            </div>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
              title="Refresh"
            >
              {refreshing ? '…' : '↺'}
            </button>
          </div>
          <div className="text-slate-400 mb-2 truncate">{health.host}</div>
          {health.up && health.models && health.models.length > 0 ? (
            <div>
              <div className="text-slate-500 mb-1">Models</div>
              {health.models.map(m => (
                <div key={m} className="text-slate-300 truncate">· {m}</div>
              ))}
            </div>
          ) : health.up ? (
            <div className="text-slate-500">No models loaded</div>
          ) : (
            <>
              {health.error && !starting && (
                <div className="text-red-400 mb-2">{health.error}</div>
              )}
              {startError && (
                <div className="text-red-400 mb-2">{startError}</div>
              )}
              {starting ? (
                <div className="flex items-center gap-1.5 mt-1 text-slate-400">
                  <span className="animate-pulse">●</span>
                  <span>Starting… (attempt {autoStartAttemptsRef.current}/{MAX_AUTO_START_ATTEMPTS})</span>
                </div>
              ) : (
                <button
                  onClick={handleStart}
                  className="w-full mt-1 px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-emerald-100 text-xs font-medium transition-colors"
                >
                  Retry
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
