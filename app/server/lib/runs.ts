import { randomUUID } from 'node:crypto'
import {
  Executor,
  assertValidGraph,
  parseGraph,
  type AnyGenServices,
  type ExecutionEvent,
  type NodeCache,
  type NodeRegistry,
  type NodeResult,
  type RunResult,
  type RunStatus,
} from '@anygen/core'
import type { Db } from './db'

export class RunRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunRequestError'
  }
}

export interface StartRunOptions {
  workflowId?: string
  /** Run only these nodes plus their dependencies. */
  targets?: string[]
}

export interface RunRecord {
  id: string
  workflowId: string | null
  status: RunStatus | 'running'
  startedAt: string
  finishedAt: string | null
  results: Record<string, NodeResult>
}

type Listener = (event: ExecutionEvent) => void

interface ActiveRun {
  id: string
  /** Replayable events for late subscribers (progress ticks are transient and not kept). */
  events: ExecutionEvent[]
  listeners: Set<Listener>
  controller: AbortController
  finished: boolean
  done: Promise<RunResult>
}

export interface RunManagerDeps {
  db: Db
  registry: NodeRegistry
  cache: NodeCache
  services: AnyGenServices
  /** Finished runs kept in memory for event replay. */
  keepFinished?: number
}

export function createRunManager({
  db,
  registry,
  cache,
  services,
  keepFinished = 50,
}: RunManagerDeps) {
  const runs = new Map<string, ActiveRun>()

  const upsertNode = db.prepare(`
    INSERT OR REPLACE INTO run_node_results
      (run_id, node_id, status, outputs, error, cached, blocked_by, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)

  const persist = (event: ExecutionEvent) => {
    const now = new Date().toISOString()
    switch (event.type) {
      case 'node:done':
        upsertNode.run(
          event.runId,
          event.nodeId,
          'done',
          JSON.stringify(event.outputs),
          null,
          event.cached ? 1 : 0,
          null,
          now,
        )
        break
      case 'node:error':
        upsertNode.run(event.runId, event.nodeId, 'error', null, event.error, 0, null, now)
        break
      case 'node:skipped':
        upsertNode.run(event.runId, event.nodeId, 'skipped', null, null, 0, event.blockedBy, now)
        break
      case 'node:cancelled':
        upsertNode.run(event.runId, event.nodeId, 'cancelled', null, null, 0, null, now)
        break
      case 'run:done':
        db.prepare('UPDATE runs SET status = ?, finished_at = ? WHERE id = ?').run(
          event.status,
          now,
          event.runId,
        )
        break
    }
  }

  const evict = () => {
    const finished = [...runs.values()].filter((r) => r.finished)
    for (const run of finished.slice(0, Math.max(0, finished.length - keepFinished))) {
      runs.delete(run.id)
    }
  }

  const getRecord = (runId: string): RunRecord | undefined => {
    const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
      | {
          id: string
          workflow_id: string | null
          status: RunRecord['status']
          started_at: string
          finished_at: string | null
        }
      | undefined
    if (!row) return undefined
    const nodes = db
      .prepare('SELECT * FROM run_node_results WHERE run_id = ?')
      .all(runId) as unknown as {
      node_id: string
      status: NodeResult['status']
      outputs: string | null
      error: string | null
      cached: number
      blocked_by: string | null
    }[]
    const results: Record<string, NodeResult> = {}
    for (const n of nodes) {
      results[n.node_id] = {
        status: n.status,
        ...(n.outputs !== null && { outputs: JSON.parse(n.outputs) }),
        ...(n.error !== null && { error: n.error }),
        ...(n.status === 'done' && { cached: n.cached === 1 }),
        ...(n.blocked_by !== null && { blockedBy: n.blocked_by }),
      }
    }
    return {
      id: row.id,
      workflowId: row.workflow_id,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      results,
    }
  }

  return {
    /**
     * Validates the graph and starts running it in the background.
     * Throws `ZodError` / `GraphValidationError` / `RunRequestError` for bad requests.
     */
    start(input: unknown, options: StartRunOptions = {}) {
      const graph = parseGraph(input)
      assertValidGraph(graph, registry)
      const unknown = (options.targets ?? []).filter((t) => !graph.nodes.some((n) => n.id === t))
      if (unknown.length > 0)
        throw new RunRequestError(`Unknown run target(s): ${unknown.join(', ')}`)

      const runId = randomUUID()
      db.prepare(
        "INSERT INTO runs (id, workflow_id, status, graph, started_at) VALUES (?, ?, 'running', ?, ?)",
      ).run(runId, options.workflowId ?? null, JSON.stringify(graph), new Date().toISOString())

      const controller = new AbortController()
      const executor = new Executor(registry, { cache })
      const run: ActiveRun = {
        id: runId,
        events: [],
        listeners: new Set(),
        controller,
        finished: false,
        done: undefined as unknown as Promise<RunResult>,
      }
      runs.set(runId, run)

      executor.on((event) => {
        try {
          persist(event)
        } catch (err) {
          console.error('[anygen] failed to persist run event', err)
        }
        if (event.type !== 'node:progress') run.events.push(event)
        for (const listener of run.listeners) {
          try {
            listener(event)
          } catch {
            // subscriber went away; it will unsubscribe itself
          }
        }
      })

      run.done = executor
        .run(graph, {
          runId,
          signal: controller.signal,
          targets: options.targets,
          services: { ...services },
        })
        .catch((err: unknown): RunResult => {
          console.error('[anygen] run crashed', err)
          db.prepare("UPDATE runs SET status = 'error', finished_at = ? WHERE id = ?").run(
            new Date().toISOString(),
            runId,
          )
          return { runId, status: 'error', results: {} }
        })
        .finally(() => {
          run.finished = true
          evict()
        })

      return { runId, done: run.done }
    },

    /** Requests cancellation of an active run. False when the run is unknown or finished. */
    cancel(runId: string): boolean {
      const run = runs.get(runId)
      if (!run || run.finished) return false
      run.controller.abort()
      return true
    },

    /**
     * Replays past events, then streams live ones. Returns an unsubscribe function, or
     * undefined if the run is not held in memory (use `get` for its stored result).
     */
    subscribe(runId: string, listener: Listener): (() => void) | undefined {
      const run = runs.get(runId)
      if (!run) return undefined
      for (const event of run.events) listener(event)
      if (run.finished) return () => {}
      run.listeners.add(listener)
      return () => run.listeners.delete(listener)
    },

    get: getRecord,

    list(limit = 50): Omit<RunRecord, 'results'>[] {
      const rows = db
        .prepare('SELECT id FROM runs ORDER BY started_at DESC LIMIT ?')
        .all(limit) as unknown as { id: string }[]
      return rows.map(({ id }) => {
        const record = getRecord(id)!
        return { ...record, results: undefined }
      })
    },
  }
}

export type RunManager = ReturnType<typeof createRunManager>
