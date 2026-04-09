import { useState, useEffect } from 'react'
import type { ProjectContext } from '../types'

const STORAGE_KEY = 'maestroid:project'

export function useProjectContext() {
  const [project, setProjectState] = useState<ProjectContext | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as ProjectContext) : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (project) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [project])

  return { project, setProject: setProjectState }
}
