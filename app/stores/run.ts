import { defineStore } from 'pinia'
import type { ExecutionEvent, GraphInput, ValidationIssue } from '@anygen/core'
import { applyEvent, emptyRunState, type RunState } from '~/utils/runState'

type ServerMessage =
  | { type: 'accepted'; runId: string; requestId?: string }
  | { type: 'event'; event: ExecutionEvent }
  | { type: 'cancelling'; runId: string; ok: boolean }
  | { type: 'error'; message: string; issues?: ValidationIssue[]; requestId?: string }

let socket: WebSocket | null = null
let opening: Promise<WebSocket> | null = null

function openSocket(onMessage: (m: ServerMessage) => void): Promise<WebSocket> {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket)
  if (opening) return opening
  opening = new Promise<WebSocket>((resolve, reject) => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${scheme}://${location.host}/_ws`)
    ws.onopen = () => {
      socket = ws
      opening = null
      resolve(ws)
    }
    ws.onerror = () => {
      opening = null
      reject(new Error('Could not connect to the AnyGen server'))
    }
    ws.onclose = () => {
      if (socket === ws) socket = null
    }
    ws.onmessage = (e) => onMessage(JSON.parse(String(e.data)) as ServerMessage)
  })
  return opening
}

export const useRunStore = defineStore('run', () => {
  const state = ref<RunState>(emptyRunState())
  const error = ref<string | null>(null)
  /** Validation problems from the last rejected run. */
  const issues = ref<ValidationIssue[]>([])
  let pendingId: string | null = null

  function handle(m: ServerMessage) {
    if (m.type === 'accepted') {
      if (m.requestId === pendingId) state.value.runId = m.runId
    } else if (m.type === 'event') {
      state.value = applyEvent(state.value, m.event)
    } else if (m.type === 'error') {
      if (m.requestId !== undefined && m.requestId !== pendingId) return
      error.value = m.message
      issues.value = m.issues ?? []
      state.value = { ...state.value, running: false }
    }
  }

  /** `targets` limits the run to those nodes plus their dependencies ("run selected"). */
  async function run(graph: GraphInput, targets?: string[]) {
    error.value = null
    issues.value = []
    try {
      const ws = await openSocket(handle)
      pendingId = crypto.randomUUID()
      // Reset immediately so stale statuses do not linger until `run:start` arrives.
      state.value = { ...emptyRunState(), running: true }
      ws.send(JSON.stringify({ type: 'run', graph, targets, requestId: pendingId }))
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      state.value = emptyRunState()
    }
  }

  function cancel() {
    const runId = state.value.runId
    if (runId && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'cancel', runId }))
    }
  }

  function clear() {
    state.value = emptyRunState()
    error.value = null
    issues.value = []
  }

  return { state, error, issues, run, cancel, clear }
})
