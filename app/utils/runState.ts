import type { ExecutionEvent, NodeProgress, PortValues } from '@anygen/core'

export type UiNodeStatus =
  'idle' | 'queued' | 'running' | 'done' | 'cached' | 'error' | 'skipped' | 'cancelled'

export interface NodeRunState {
  status: UiNodeStatus
  progress?: NodeProgress
  outputs?: PortValues
  error?: string
  blockedBy?: string
}

export interface RunState {
  runId: string | null
  running: boolean
  /** `done` / `error` / `cancelled` once the run has finished. */
  finished: 'done' | 'error' | 'cancelled' | null
  nodes: Record<string, NodeRunState>
}

export const emptyRunState = (): RunState => ({
  runId: null,
  running: false,
  finished: null,
  nodes: {},
})

/** Returns the state after `event`. Events of other runs are ignored. */
export function applyEvent(state: RunState, event: ExecutionEvent): RunState {
  if (event.type === 'run:start') {
    return {
      runId: event.runId,
      running: true,
      finished: null,
      nodes: Object.fromEntries(event.nodeIds.map((id) => [id, { status: 'queued' as const }])),
    }
  }
  if (state.runId !== event.runId) return state

  if (event.type === 'run:done') {
    const nodes = { ...state.nodes }
    for (const [id, r] of Object.entries(event.results)) {
      const prev = nodes[id]
      if (prev && prev.status !== 'queued' && prev.status !== 'running') continue
      nodes[id] = {
        status: r.status === 'done' && r.cached ? 'cached' : r.status,
        outputs: r.outputs,
        error: r.error,
        blockedBy: r.blockedBy,
      }
    }
    return { ...state, running: false, finished: event.status, nodes }
  }

  const prev = state.nodes[event.nodeId] ?? { status: 'queued' as const }
  let next: NodeRunState
  switch (event.type) {
    case 'node:start':
      next = { status: 'running' }
      break
    case 'node:progress':
      next = { ...prev, status: 'running', progress: event.progress }
      break
    case 'node:done':
      next = { status: event.cached ? 'cached' : 'done', outputs: event.outputs }
      break
    case 'node:error':
      next = { status: 'error', error: event.error }
      break
    case 'node:skipped':
      next = { status: 'skipped', blockedBy: event.blockedBy }
      break
    case 'node:cancelled':
      next = { status: 'cancelled' }
      break
  }
  return { ...state, nodes: { ...state.nodes, [event.nodeId]: next } }
}
