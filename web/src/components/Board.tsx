import { useState, useCallback, useRef } from 'react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { COLUMNS } from '../types'
import type { Task, ColumnId, PrePlanningResult, PlanningResult, WBSElement } from '../types'
import { loadSerenaContext, prePlan, plan, sendClarification, streamExecution, verify } from '../api/client'
import { Column } from './Column'
import { DecisionGateModal } from './DecisionGateModal'
import { PlanningResultModal } from './PlanningResultModal'
import { VerificationModal } from './VerificationModal'
import { ClarificationModal } from './ClarificationModal'
import { ProjectSetupModal } from './ProjectSetupModal'
import { AddTaskModal } from './AddTaskModal'
import { SpecModal } from './SpecModal'
import { useTasks } from '../store/tasks'
import { useProjectContext } from '../store/project'
import { OllamaStatus } from './OllamaStatus'

// ---------------------------------------------------------------------------
// Spec section builders — merge structured markdown into the living spec
// ---------------------------------------------------------------------------

function buildPrePlanningSection(result: PrePlanningResult): string {
  const lines: string[] = ['## Pre-Planning Analysis', '']
  lines.push(`**Specification:** ${result.specification}`, '')
  lines.push(`**Complexity:** ${result.complexityScore}/100 (${result.complexityLevel}) · ${result.estimatedHours}h · $${result.estimatedCost.toFixed(2)}`, '')
  if (result.successCriteria.length > 0) {
    lines.push('**Success Criteria:**')
    result.successCriteria.forEach(c => lines.push(`- ${c}`))
    lines.push('')
  }
  if (result.risks.length > 0) {
    lines.push('**Risks:**')
    result.risks.forEach(r => lines.push(`- [${r.severity}] ${r.description} → ${r.mitigation}`))
    lines.push('')
  }
  if (result.constraints.length > 0) {
    lines.push('**Constraints:**')
    result.constraints.forEach(c => lines.push(`- ${c}`))
    lines.push('')
  }
  if (result.assumptions.length > 0) {
    lines.push('**Assumptions:**')
    result.assumptions.forEach(a => lines.push(`- ${a}`))
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

function buildPlanningSection(result: PlanningResult): string {
  const byId = new Map(result.wbs.elements.map(element => [element.id, element]))
  const wps = result.wbs.elements.filter(e => e.isWorkPackage)
  const lines: string[] = ['## Planning Specification', '']
  lines.push(`**Specification:** ${result.specification}`, '')

  lines.push('**Planning Summary:**')
  lines.push(`- Work packages: ${wps.length}`)
  lines.push(`- Total estimated hours: ${result.wbs.totalEstimatedHours.toFixed(0)}h`)
  lines.push(`- Critical path: ${result.wbs.criticalPathHours.toFixed(0)}h`)
  if (result.wbs.parallelOpportunities > 0) {
    lines.push(`- Parallel opportunities: ${result.wbs.parallelOpportunities}`)
  }
  lines.push('')

  if (result.executionPlan.length > 0) {
    lines.push('**Execution Plan:**')
    result.executionPlan.forEach(phase => {
      const phaseItems = phase.workPackageIds.map(id => {
        const wp = byId.get(id)
        return wp ? `${id} (${wp.title})` : id
      })
      const parallelSuffix = phase.canParallelize ? ' [parallelizable]' : ''
      lines.push(`- Phase ${phase.phaseNumber} — ${phase.name}${parallelSuffix}: ${phaseItems.join(', ')}`)
    })
    lines.push('')
  }

  if (wps.length > 0) {
    lines.push('**Implementation Work Packages:**', '')
    wps.forEach(wp => {
      const hrs = wp.estimatedHours != null ? ` · ${wp.estimatedHours}h` : ''
      lines.push(`### ${wp.id} — ${wp.title}${hrs}`)
      if (wp.description) lines.push(`**Description:** ${wp.description}`)
      if (wp.deliverable) lines.push(`**Deliverable:** ${wp.deliverable}`)
      if (wp.assignedAgent?.name) lines.push(`**Assigned Agent:** ${wp.assignedAgent.name}`)
      if (wp.assignedAgent?.instructions) lines.push(`**Agent Instructions:** ${wp.assignedAgent.instructions}`)
      if (wp.prerequisites.length > 0) {
        lines.push('**Prerequisites:**')
        wp.prerequisites.forEach(prereqId => {
          const prereq = byId.get(prereqId)
          lines.push(`- ${prereqId}${prereq ? ` — ${prereq.title}` : ''}`)
        })
      }
      if (wp.successCriteria.length > 0) {
        lines.push('**Success Criteria:**')
        wp.successCriteria.forEach(criteria => lines.push(`- ${criteria}`))
      }
      lines.push('')
    })
  }

  return lines.join('\n').trimEnd()
}

function logMissingAssignedAgents(result: PlanningResult): void {
  const invalidAgents = result.wbs.elements
    .filter(e => e.isWorkPackage)
    .filter(e => !e.assignedAgent?.name?.trim())

  if (invalidAgents.length === 0) return

  console.warn('[planning] work packages missing assigned agent names', {
    scopeId: result.scopeId,
    workPackages: invalidAgents.map(wp => ({
      id: wp.id,
      title: wp.title,
      estimatedHours: wp.estimatedHours,
      assignedAgent: wp.assignedAgent ?? null,
      deliverable: wp.deliverable ?? null,
      successCriteria: wp.successCriteria,
    })),
  })
}

function buildWorkPackageSpec(parent: Task, wp: WBSElement): string {
  const lines: string[] = [
    '## Parent Task',
    '',
    `${parent.title} (#${parent.id})`,
    '',
    '## Work Package',
    '',
    `**ID:** ${wp.id}`,
    `**Title:** ${wp.title}`,
  ]
  if (wp.description) lines.push(`**Description:** ${wp.description}`)
  lines.push('')
  if (wp.deliverable) lines.push(`**Deliverable:** ${wp.deliverable}`, '')
  if (wp.assignedAgent) {
    lines.push(`**Agent:** ${wp.assignedAgent.name}`)
    if (wp.assignedAgent.instructions) lines.push(`**Agent Instructions:** ${wp.assignedAgent.instructions}`)
    lines.push('')
  }
  if (wp.successCriteria.length > 0) {
    lines.push('**Success Criteria:**')
    wp.successCriteria.forEach(c => lines.push(`- ${c}`))
    lines.push('')
  }
  if (wp.prerequisites.length > 0) {
    lines.push('**Prerequisites:**')
    wp.prerequisites.forEach(p => lines.push(`- ${p}`))
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

function isLocalProjectPath(source?: string): source is string {
  return !!source && !/^https?:\/\//i.test(source)
}

function getExecutionSequence(plan: PlanningResult): Array<{ phaseNumber: number; phaseName: string; wp: WBSElement }> {
  const byId = new Map(plan.wbs.elements.map(element => [element.id, element]))
  const seen = new Set<string>()
  const sequence: Array<{ phaseNumber: number; phaseName: string; wp: WBSElement }> = []

  plan.executionPlan.forEach(phase => {
    phase.workPackageIds.forEach(id => {
      const wp = byId.get(id)
      if (!wp?.isWorkPackage || seen.has(id)) return
      seen.add(id)
      sequence.push({ phaseNumber: phase.phaseNumber, phaseName: phase.name, wp })
    })
  })

  const remaining = plan.wbs.elements
    .filter(element => element.isWorkPackage && !seen.has(element.id))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))

  remaining.forEach(wp => {
    sequence.push({
      phaseNumber: plan.executionPlan.length + 1,
      phaseName: 'Unscheduled work packages',
      wp,
    })
  })

  return sequence
}

function buildExecutionRoleInstructions(wp: WBSElement): string {
  return [
    'You are executing one planned work package inside a larger approved plan.',
    'Stay within the work package scope unless you need a small supporting change to complete it safely.',
    'Use the work package instructions below as the execution role definition.',
    '',
    wp.assignedAgent?.instructions ?? 'No agent instructions were provided.',
  ].join('\n')
}

function buildWorkPackageExecutionTaskWithContext(parent: Task, wp: WBSElement, serenaContext?: string | null): string {
  const lines: string[] = [
    `Parent task: ${parent.title}`,
    `Work package: ${wp.id} — ${wp.title}`,
    '',
    'Implement this work package in the current repository.',
  ]

  if (serenaContext?.trim()) lines.push('', `Task-relevant code context (from Serena):\n${serenaContext}`)
  if (wp.description) lines.push('', `Description:\n${wp.description}`)
  if (wp.deliverable) lines.push('', `Deliverable:\n${wp.deliverable}`)
  if (wp.prerequisites.length > 0) lines.push('', `Prerequisites already planned:\n- ${wp.prerequisites.join('\n- ')}`)
  if (wp.successCriteria.length > 0) lines.push('', `Work package success criteria:\n- ${wp.successCriteria.join('\n- ')}`)
  if (parent.planningResult?.specification) lines.push('', `Plan-wide implementation brief:\n${parent.planningResult.specification}`)
  lines.push('', 'When complete, summarize the concrete files changed, tests run, and any follow-up risks.')

  return lines.join('\n')
}

function getVerificationCriteria(task: Task): string[] {
  if (task.prePlanningResult?.successCriteria.length) {
    return task.prePlanningResult.successCriteria
  }

  const criteria = new Set<string>()
  task.planningResult?.wbs.elements
    .filter(element => element.isWorkPackage)
    .forEach(element => {
      element.successCriteria
        .map(item => item.trim())
        .filter(Boolean)
        .forEach(item => criteria.add(item))
    })

  return Array.from(criteria)
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function Board() {
  const {
    tasks, addTask, updateTask, moveTask, removeTask,
    startExecution,
    setLoading, setError,
    setPrePlanning, setPlanning,
    appendExecutionOutput, setClarification, clearClarification, setVerification,
    setSpec, upsertSpec, setDerivedFrom,
  } = useTasks()
  const { project, setProject } = useProjectContext()
  const [gateTask, setGateTask] = useState<Task | null>(null)
  const [planDetailTask, setPlanDetailTask] = useState<Task | null>(null)
  const [pendingPlanTask, setPendingPlanTask] = useState<Task | null>(null)
  const [verifyTask, setVerifyTask] = useState<Task | null>(null)
  const [specTask, setSpecTask] = useState<Task | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [editProject, setEditProject] = useState(false)
  const [verifyLoading, _setVerifyLoading] = useState(false)
  const [clarifyLoading, setClarifyLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const abortStreams = useRef(new Map<string, () => void>())
  const cancelledExecution = useRef(new Set<string>())
  // Map of taskId → AbortController for in-flight pre-plan / plan requests
  const abortAnalysis = useRef(new Map<string, AbortController>())

  const buildContext = useCallback(() => project?.generatedContext ?? '', [project])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const runWorkPackageExecution = useCallback((
    parentTaskId: string,
    parentTask: Task,
    phaseNumber: number,
    phaseName: string,
    wp: WBSElement,
    workingDirectory: string,
    serenaContext?: string | null,
  ) => new Promise<{ output: string; cost: number; durationMs: number }>((resolve, reject) => {
    let settled = false

    appendExecutionOutput(
      parentTaskId,
      `\n\n=== Phase ${phaseNumber}: ${phaseName} | ${wp.id} — ${wp.title} ===\n`
    )

    const abort = streamExecution(
      {
        task: buildWorkPackageExecutionTaskWithContext(parentTask, wp, serenaContext),
        roleName: wp.assignedAgent?.name ?? 'unassigned',
        roleInstructions: buildExecutionRoleInstructions(wp),
        workingDirectory,
        permissionMode: 'acceptEdits',
        enableClarification: true,
      },
      {
        onProgress: (message) => {
          appendExecutionOutput(parentTaskId, message)
        },
        onToolCall: (toolName, inputPreview) => {
          appendExecutionOutput(parentTaskId, `\n[tool:${toolName}] ${inputPreview}\n`)
        },
        onClarification: (request) => {
          setClarification(parentTaskId, request)
        },
        onComplete: (output, cost, durationMs) => {
          if (settled) return
          settled = true
          abortStreams.current.delete(parentTaskId)
          appendExecutionOutput(parentTaskId, `\n[complete] ${wp.id} finished in ${(durationMs / 1000).toFixed(1)}s · $${cost.toFixed(4)}\n`)
          resolve({ output, cost, durationMs })
        },
        onError: (message) => {
          if (settled) return
          settled = true
          abortStreams.current.delete(parentTaskId)
          reject(new Error(message))
        },
      }
    )

    abortStreams.current.set(parentTaskId, () => {
      abort()
      if (settled) return
      settled = true
      abortStreams.current.delete(parentTaskId)
      reject(new Error(`Execution cancelled during work package ${wp.id}.`))
    })
  }), [appendExecutionOutput, setClarification])

  const handleStartDevelopment = useCallback(async (task: Task) => {
    const planResult = task.planningResult
    const workingDirectory = project?.source
    if (!planResult) {
      showToast('Cannot start development without a planning result.')
      return
    }

    if (!isLocalProjectPath(workingDirectory)) {
      showToast('Development execution requires a local project path. Edit the project context and choose a local repository folder.')
      return
    }

    const sequence = getExecutionSequence(planResult)
    if (sequence.length === 0) {
      showToast('Cannot start development because the plan has no executable work packages.')
      return
    }

    const missingAgents = sequence.filter(step => !step.wp.assignedAgent?.name?.trim())
    if (missingAgents.length > 0) {
      showToast(
        `Cannot start development because the current plan is incomplete. ` +
        `Missing assigned agents for: ${missingAgents.map(step => `${step.wp.id} (${step.wp.title || 'untitled'})`).join(', ')}. ` +
        `Re-run planning after restarting the API so the stricter planner validation is used.`
      )
      return
    }

    moveTask(task.id, 'in-development')
    startExecution(task.id)
    setPendingPlanTask(null)
    setPlanDetailTask(null)
    cancelledExecution.current.delete(task.id)

    const completedOutputs: string[] = []

    try {
      for (const step of sequence) {
        const serenaTask = [
          `Parent task: ${task.title}`,
          `Work package: ${step.wp.id} — ${step.wp.title}`,
          step.wp.description,
          step.wp.deliverable ? `Deliverable: ${step.wp.deliverable}` : '',
        ].filter(Boolean).join('\n')

        const serenaContext = await loadSerenaContext(workingDirectory, serenaTask)
        const result = await runWorkPackageExecution(
          task.id,
          task,
          step.phaseNumber,
          step.phaseName,
          step.wp,
          workingDirectory,
          serenaContext,
        )
        completedOutputs.push(`## ${step.wp.id} — ${step.wp.title}\n\n${result.output}`.trim())
      }

      const verificationCriteria = getVerificationCriteria(task)
      moveTask(task.id, 'verification')

      if (verificationCriteria.length === 0) {
        setLoading(task.id, false)
        return
      }

      setLoading(task.id, true)
      const verification = await verify(
        task.title,
        verificationCriteria,
        completedOutputs.join('\n\n')
      )
      setVerification(task.id, verification)
    } catch (err) {
      if (cancelledExecution.current.has(task.id)) {
        cancelledExecution.current.delete(task.id)
        return
      }

      const message = err instanceof Error ? err.message : String(err)
      setError(task.id, message)
      moveTask(task.id, 'planning')
      showToast(`Development failed: ${message}`)
    } finally {
      abortStreams.current.delete(task.id)
    }
  }, [moveTask, project, runWorkPackageExecution, setError, setLoading, setVerification, showToast, startExecution])

  // ---------------------------------------------------------------------------
  // Drag handler — only valid transitions trigger actions
  // ---------------------------------------------------------------------------
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    console.log('[drag] end', { activeId: active.id, overId: over?.id })
    if (!over) { console.log('[drag] no drop target'); return }

    const taskId = active.id as string
    const targetCol = over.id as ColumnId
    const task = tasks.find(t => t.id === taskId)
    console.log('[drag] task:', task?.column, '→', targetCol)
    if (!task || task.column === targetCol || task.loading) { console.log('[drag] early return', { task: !!task, sameCol: task?.column === targetCol, loading: task?.loading }); return }

    // backlog → pre-planning
    if (task.column === 'backlog' && targetCol === 'pre-planning') {
      moveTask(taskId, 'pre-planning')
      setLoading(taskId, true)
      const controller = new AbortController()
      abortAnalysis.current.set(taskId, controller)
      try {
        console.log('[pre-planning] calling API...')
        const result = await prePlan(task.spec, buildContext(), controller.signal)
        setPrePlanning(taskId, result)
        upsertSpec(taskId, buildPrePlanningSection(result))
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[pre-planning] failed:', msg)
        setError(taskId, msg)
        moveTask(taskId, 'backlog')
        showToast(`Pre-planning failed: ${msg}`)
      } finally {
        abortAnalysis.current.delete(taskId)
      }
      return
    }

    // planning → in-development (drag escape hatch — bypasses plan review modal)
    if (task.column === 'planning' && targetCol === 'in-development') {
      void handleStartDevelopment(task)
      return
    }

    // in-development → verification: trigger LLM verify
    if (task.column === 'in-development' && targetCol === 'verification') {
      moveTask(taskId, 'verification')
      setLoading(taskId, true)
      try {
        const criteria = getVerificationCriteria(task)
        const result = await verify(task.title, criteria, task.executionOutput ?? '')
        setVerification(taskId, result)
        setVerifyTask(tasks.find(t => t.id === taskId) ?? task)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(taskId, msg)
        moveTask(taskId, 'in-development')
        showToast(`Verification failed: ${msg}`)
      }
      return
    }

    // verification → done (manual drag, skip modal)
    if (task.column === 'verification' && targetCol === 'done') {
      moveTask(taskId, 'done')
      return
    }

    // in-development → done (direct, bypass verification)
    if (task.column === 'in-development' && targetCol === 'done') {
      moveTask(taskId, 'done')
      return
    }

    // All other drops are ignored (card snaps back)
  }, [tasks, moveTask, setLoading, setError, setPrePlanning, setPlanning, setVerification, showToast, buildContext, upsertSpec, handleStartDevelopment])

  // ---------------------------------------------------------------------------
  // Decision gate actions
  // ---------------------------------------------------------------------------
  const handleGateApprove = useCallback(async () => {
    if (!gateTask) return
    moveTask(gateTask.id, 'planning')
    setLoading(gateTask.id, true)
    setGateTask(null)
    const controller = new AbortController()
    abortAnalysis.current.set(gateTask.id, controller)
    try {
      // Read spec fresh from store — it was updated by upsertSpec after pre-planning
      const currentSpec = tasks.find(t => t.id === gateTask.id)?.spec ?? gateTask.spec
      const result = await plan(currentSpec, gateTask.prePlanningResult!, buildContext(), project?.source, controller.signal)
      logMissingAssignedAgents(result)
      setPlanning(gateTask.id, result)
      upsertSpec(gateTask.id, buildPlanningSection(result))
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      const msg = err instanceof Error ? err.message : String(err)
      setError(gateTask.id, msg)
      moveTask(gateTask.id, 'pre-planning')
      showToast(`Planning failed: ${msg}`)
    } finally {
      abortAnalysis.current.delete(gateTask.id)
    }
  }, [gateTask, tasks, moveTask, setLoading, setError, setPlanning, buildContext, upsertSpec])

  const handlePromoteWorkPackages = useCallback((parentTask: Task) => {
    const wps = parentTask.planningResult?.wbs.elements.filter(e => e.isWorkPackage) ?? []
    wps.forEach(wp => {
      addTask(`${wp.id}: ${wp.title}`, buildWorkPackageSpec(parentTask, wp), parentTask.id)
    })
    setPendingPlanTask(null)
    setPlanDetailTask(null)
  }, [addTask])

  const handleSplitToStandalone = useCallback((task: Task) => {
    const newTask = addTask(task.title, task.spec)
    setDerivedFrom(newTask.id, task.id)
    removeTask(task.id)
    setPendingPlanTask(null)
    setPlanDetailTask(null)
  }, [addTask, setDerivedFrom, removeTask])

  const handleCancelTask = useCallback((taskId: string, fromColumn: ColumnId) => {
    if (fromColumn === 'in-development') {
      cancelledExecution.current.add(taskId)
      abortStreams.current.get(taskId)?.()
      abortStreams.current.delete(taskId)
      clearClarification(taskId)
      moveTask(taskId, 'planning')
      setLoading(taskId, false)
      return
    }

    abortAnalysis.current.get(taskId)?.abort()
    abortAnalysis.current.delete(taskId)
    moveTask(taskId, 'backlog')
    setLoading(taskId, false)
  }, [clearClarification, moveTask, setLoading])

  const handlePrePlanAll = useCallback(async (children: Task[]) => {
    const eligible = children.filter(t => t.column === 'backlog' && !t.prePlanningResult && !t.loading)
    if (eligible.length === 0) return
    // Move all to pre-planning first so the UI updates immediately
    eligible.forEach(t => { moveTask(t.id, 'pre-planning'); setLoading(t.id, true) })
    await Promise.all(eligible.map(async t => {
      const controller = new AbortController()
      abortAnalysis.current.set(t.id, controller)
      try {
        const result = await prePlan(t.spec, buildContext(), controller.signal)
        setPrePlanning(t.id, result)
        upsertSpec(t.id, buildPrePlanningSection(result))
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        const msg = err instanceof Error ? err.message : String(err)
        setError(t.id, msg)
        moveTask(t.id, 'backlog')
        showToast(`Pre-planning failed for "${t.title}": ${msg}`)
      } finally {
        abortAnalysis.current.delete(t.id)
      }
    }))
  }, [moveTask, setLoading, setError, setPrePlanning, buildContext, upsertSpec, showToast])

  const handleGateSkip = useCallback(() => {
    if (!gateTask) return
    moveTask(gateTask.id, 'in-development')
    setGateTask(null)
  }, [gateTask, moveTask])

  const handleGateCancel = useCallback(() => {
    if (!gateTask) return
    moveTask(gateTask.id, 'backlog')
    setGateTask(null)
  }, [gateTask, moveTask])

  // ---------------------------------------------------------------------------
  // Verification actions
  // ---------------------------------------------------------------------------
  const handleVerifyApprove = useCallback(() => {
    if (!verifyTask) return
    moveTask(verifyTask.id, 'done')
    setVerifyTask(null)
  }, [verifyTask, moveTask])

  const handleVerifyReject = useCallback(() => {
    if (!verifyTask) return
    moveTask(verifyTask.id, 'in-development')
    setVerifyTask(null)
  }, [verifyTask, moveTask])

  // ---------------------------------------------------------------------------
  // Clarification (mid-execution human answer)
  // ---------------------------------------------------------------------------
  const handleClarificationSubmit = useCallback(async (taskId: string, answer: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task?.pendingClarification) return
    setClarifyLoading(true)
    try {
      await sendClarification(task.pendingClarification.requestId, answer)
      clearClarification(taskId)
      setLoading(taskId, true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`Failed to send clarification: ${msg}`)
    } finally {
      setClarifyLoading(false)
    }
  }, [tasks, clearClarification, setLoading, showToast])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      {/* Topbar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-white tracking-tight">Maestroid</span>
          <span className="text-xs bg-slate-700 text-slate-300 rounded px-2 py-0.5">MVP</span>
          {project && (
            <div className="flex items-center gap-1.5 ml-2">
              <span className="text-slate-500">·</span>
              <span className="text-sm text-slate-300">{project.name}</span>
              <button
                onClick={() => setEditProject(true)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-1"
                title="Edit project context"
              >
                ✎
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          <OllamaStatus />
          <button
            onClick={() => setShowAdd(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            + New Task
          </button>
        </div>
      </header>

      {/* Board */}
      <div className="flex-1 overflow-x-auto p-6">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 h-full min-w-max">
            {COLUMNS.map(col => (
              <Column
                key={col.id}
                id={col.id}
                label={col.label}
                accent={col.accent}
                headerBg={col.headerBg}
                tasks={tasks.filter(t => t.column === col.id)}
                allTasks={tasks}
                onPrePlanAll={handlePrePlanAll}
                onCardClick={
                  col.id === 'backlog'
                    ? (task) => setSpecTask(task)
                    : col.id === 'pre-planning'
                    ? (task) => { if (task.prePlanningResult && !task.loading) setGateTask(task) }
                    : col.id === 'planning'
                    ? (task) => { if (task.planningResult) setPlanDetailTask(task) }
                    : col.id === 'verification'
                    ? (task) => { if (task.verificationResult) setVerifyTask(task) }
                    : (col.id === 'in-development' || col.id === 'done')
                    ? (task) => { if (task.planningResult) setPlanDetailTask(task) }
                    : undefined
                }
                onEditTask={(task) => setEditTask(task)}
                onCancelTask={(task) => handleCancelTask(task.id, task.column)}
                onViewSpec={(task) => setSpecTask(task)}
              />
            ))}
          </div>
        </DndContext>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-lg w-full px-4">
          <div className="bg-red-900 border border-red-700 text-red-200 text-sm rounded-xl px-4 py-3 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="text-red-400 mt-0.5 shrink-0">⚠</span>
              <div className="flex-1 min-w-0 max-h-48 overflow-y-auto">
                <p className="break-all font-mono text-xs leading-relaxed select-text">{toast}</p>
              </div>
              <button onClick={() => setToast(null)} className="text-red-400 hover:text-white ml-2 shrink-0 text-lg leading-none">×</button>
            </div>
            <div className="flex gap-3 mt-2 pl-5">
              <button
                onClick={() => navigator.clipboard.writeText(toast)}
                className="text-xs text-red-400 hover:text-red-200 transition-colors"
              >
                Copy error
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {!project && (
        <ProjectSetupModal onSave={setProject} />
      )}
      {editProject && project && (
        <ProjectSetupModal
          initial={project}
          onSave={(ctx) => { setProject(ctx); setEditProject(false) }}
          onClose={() => setEditProject(false)}
        />
      )}
      {(pendingPlanTask || planDetailTask) && (() => {
        const t = (pendingPlanTask ?? planDetailTask)!
        const alreadyPromoted = tasks.some(task => task.parentId === t.id)
        return (
          <PlanningResultModal
            task={t}
            onStartDevelopment={t.column === 'planning' ? () => void handleStartDevelopment(t) : undefined}
            onPromoteWorkPackages={t.column === 'planning' && t.planningResult && !alreadyPromoted && !t.parentId ? () => handlePromoteWorkPackages(t) : undefined}
            onSplitToStandalone={t.column === 'planning' && !!t.parentId ? () => handleSplitToStandalone(t) : undefined}
            onClose={() => { setPendingPlanTask(null); setPlanDetailTask(null) }}
          />
        )
      })()}
      {gateTask && (
        <DecisionGateModal
          task={gateTask}
          onApprove={handleGateApprove}
          onSkipPlanning={handleGateSkip}
          onCancel={handleGateCancel}
          onClose={() => setGateTask(null)}
          loading={false}
        />
      )}
      {verifyTask && verifyTask.verificationResult && (
        <VerificationModal
          task={verifyTask}
          onApprove={handleVerifyApprove}
          onReject={handleVerifyReject}
          onClose={() => setVerifyTask(null)}
          loading={verifyLoading}
        />
      )}
      {/* Clarification: auto-show when any in-development task has a pending question */}
      {(() => {
        const clarTask = tasks.find(t => t.pendingClarification)
        if (!clarTask?.pendingClarification) return null
        return (
          <ClarificationModal
            taskTitle={clarTask.title}
            request={clarTask.pendingClarification}
            onSubmit={(answer) => handleClarificationSubmit(clarTask.id, answer)}
            loading={clarifyLoading}
          />
        )
      })()}
      {specTask && (
        <SpecModal
          task={specTask}
          onSave={(spec) => setSpec(specTask.id, spec)}
          onClose={() => setSpecTask(null)}
        />
      )}
      {showAdd && (
        <AddTaskModal
          projectPrefix={project ? `## Project\n\n**${project.name}**\n${project.source}` : undefined}
          onSubmit={(title, spec) => addTask(title, spec)}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editTask && (
        <AddTaskModal
          mode="edit"
          initialValue={editTask.title}
          initialSpec={editTask.spec}
          onSubmit={(title, spec) => {
            if (title !== editTask.title) {
              updateTask(editTask.id, title) // resets AI data via reducer
            } else {
              setSpec(editTask.id, spec)
            }
          }}
          onClose={() => setEditTask(null)}
        />
      )}
    </div>
  )
}
