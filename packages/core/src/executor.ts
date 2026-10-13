import { randomUUID } from 'node:crypto'
import { MemoryCache, hashValue, type NodeCache } from './cache'
import type { ExecutionEvent, ExecutionListener, NodeResult, RunStatus } from './events'
import { parseGraph, type Graph, type GraphInput } from './graph'
import type { NodeRegistry } from './registry'
import type { NodeDefinition, PortValues } from './types'
import { assertValidGraph } from './validate'

export interface ExecutorOptions {
  /** Result cache shared across runs. Defaults to a fresh in-memory cache. */
  cache?: NodeCache
  /** Max nodes executing at once. Defaults to unlimited. */
  maxConcurrency?: number
}

export interface RunOptions {
  runId?: string
  signal?: AbortSignal
  /** Run only these nodes and everything they depend on ("run selected"). */
  targets?: string[]
  /** Passed to every node as `ctx.services`. */
  services?: Record<string, unknown>
}

export interface RunResult {
  runId: string
  status: RunStatus
  results: Record<string, NodeResult>
}

class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled')
    this.name = 'RunCancelledError'
  }
}

export class Executor {
  private readonly cache: NodeCache
  private readonly maxConcurrency: number
  private readonly listeners = new Set<ExecutionListener>()

  constructor(
    private readonly registry: NodeRegistry,
    options: ExecutorOptions = {},
  ) {
    this.cache = options.cache ?? new MemoryCache()
    this.maxConcurrency = options.maxConcurrency ?? Infinity
  }

  /** Subscribe to execution events. Returns an unsubscribe function. */
  on(listener: ExecutionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: ExecutionEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A misbehaving listener must not break the run.
      }
    }
  }

  /**
   * Validates then runs the graph. Independent branches run in parallel; a failing node only
   * skips its dependents. Rejects with `GraphValidationError` for invalid graphs; node failures
   * and cancellation are reported through the returned result instead.
   */
  async run(graphInput: Graph | GraphInput, options: RunOptions = {}): Promise<RunResult> {
    const graph = parseGraph(graphInput)
    assertValidGraph(graph, this.registry)

    const runId = options.runId ?? randomUUID()
    const signal = options.signal ?? new AbortController().signal
    const services = options.services ?? {}

    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]))
    const upstream = new Map<string, Set<string>>(graph.nodes.map((n) => [n.id, new Set()]))
    for (const { from, to } of graph.edges) upstream.get(to.node)!.add(from.node)

    const active = activeNodes(graph, upstream, options.targets)
    const pending = new Set(graph.nodes.map((n) => n.id).filter((id) => active.has(id)))
    const running = new Set<string>()
    const results: Record<string, NodeResult> = {}

    this.emit({ type: 'run:start', runId, nodeIds: [...pending] })

    return new Promise<RunResult>((resolve) => {
      let onAbort: () => void = () => {}
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(new RunCancelledError())
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      })
      cancelled.catch(() => {}) // only consumed through the race below

      const settle = (nodeId: string, result: NodeResult) => {
        results[nodeId] = result
        pending.delete(nodeId)
        running.delete(nodeId)
      }

      const finish = () => {
        signal.removeEventListener('abort', onAbort)
        const values = Object.values(results)
        const status: RunStatus = values.some((r) => r.status === 'cancelled')
          ? 'cancelled'
          : values.some((r) => r.status === 'error')
            ? 'error'
            : 'done'
        this.emit({ type: 'run:done', runId, status, results })
        resolve({ runId, status, results })
      }

      const schedule = () => {
        if (signal.aborted) {
          for (const id of [...pending]) {
            if (running.has(id)) continue
            settle(id, { status: 'cancelled' })
            this.emit({ type: 'node:cancelled', runId, nodeId: id })
          }
        }

        // Skip anything downstream of a failure (repeat: skips cascade).
        let changed = true
        while (changed) {
          changed = false
          for (const id of [...pending]) {
            if (running.has(id)) continue
            const blocker = [...upstream.get(id)!].find((dep) => {
              const status = results[dep]?.status
              return status === 'error' || status === 'skipped' || status === 'cancelled'
            })
            if (blocker === undefined) continue
            const root = results[blocker]!.blockedBy ?? blocker
            settle(id, { status: 'skipped', blockedBy: root })
            this.emit({ type: 'node:skipped', runId, nodeId: id, blockedBy: root })
            changed = true
          }
        }

        for (const id of pending) {
          if (running.size >= this.maxConcurrency) break
          if (running.has(id)) continue
          if (![...upstream.get(id)!].every((dep) => results[dep]?.status === 'done')) continue
          running.add(id)
          void this.runNode(
            runId,
            nodesById.get(id)!,
            graph,
            results,
            signal,
            services,
            cancelled,
          ).then((result) => {
            settle(id, result)
            schedule()
          })
        }

        if (pending.size === 0) finish()
      }

      schedule()
    })
  }

  private async runNode(
    runId: string,
    node: Graph['nodes'][number],
    graph: Graph,
    results: Record<string, NodeResult>,
    signal: AbortSignal,
    services: Record<string, unknown>,
    cancelled: Promise<never>,
  ): Promise<NodeResult> {
    const def = this.registry.get(node.type)!
    const nodeId = node.id

    let inputs: PortValues
    let params: PortValues
    try {
      inputs = resolveInputs(def, node.id, graph, results)
      params = resolveParams(def, node.params)
    } catch (err) {
      return this.fail(runId, nodeId, err)
    }

    const cacheKey = def.cache
      ? hashValue({ type: def.id, version: def.version, inputs, params })
      : undefined
    const hit = cacheKey ? this.cache.get(cacheKey) : undefined
    if (hit) {
      this.emit({ type: 'node:done', runId, nodeId, outputs: hit, cached: true })
      return { status: 'done', outputs: hit, cached: true }
    }

    let settled = false
    this.emit({ type: 'node:start', runId, nodeId })
    try {
      const outputs = await Promise.race([
        Promise.resolve().then(() =>
          def.execute(
            {
              runId,
              nodeId,
              signal,
              services,
              progress: (progress) => {
                if (!settled) this.emit({ type: 'node:progress', runId, nodeId, progress })
              },
            },
            inputs,
            params,
          ),
        ),
        cancelled,
      ])
      settled = true
      if (outputs === null || typeof outputs !== 'object' || Array.isArray(outputs)) {
        throw new Error(`Node "${def.id}" must return an object of outputs`)
      }
      if (cacheKey) this.cache.set(cacheKey, outputs)
      this.emit({ type: 'node:done', runId, nodeId, outputs, cached: false })
      return { status: 'done', outputs, cached: false }
    } catch (err) {
      settled = true
      if (err instanceof RunCancelledError || signal.aborted) {
        this.emit({ type: 'node:cancelled', runId, nodeId })
        return { status: 'cancelled' }
      }
      return this.fail(runId, nodeId, err)
    }
  }

  private fail(runId: string, nodeId: string, err: unknown): NodeResult {
    const error = err instanceof Error ? err.message : String(err)
    this.emit({ type: 'node:error', runId, nodeId, error })
    return { status: 'error', error }
  }
}

/** All nodes when no targets are given; otherwise the targets and their transitive upstream. */
function activeNodes(graph: Graph, upstream: Map<string, Set<string>>, targets?: string[]) {
  if (!targets) return new Set(graph.nodes.map((n) => n.id))
  const unknown = targets.filter((t) => !upstream.has(t))
  if (unknown.length > 0) throw new Error(`Unknown run target(s): ${unknown.join(', ')}`)
  const active = new Set<string>()
  const stack = [...targets]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (active.has(id)) continue
    active.add(id)
    stack.push(...upstream.get(id)!)
  }
  return active
}

function resolveInputs(
  def: NodeDefinition,
  nodeId: string,
  graph: Graph,
  results: Record<string, NodeResult>,
): PortValues {
  const inputs: PortValues = {}
  for (const port of def.inputs) {
    const edge = graph.edges.find((e) => e.to.node === nodeId && e.to.port === port.name)
    let value: unknown
    if (edge) {
      value = results[edge.from.node]?.outputs?.[edge.from.port]
      if (value === undefined && port.required && port.default === undefined) {
        throw new Error(
          `Input "${port.name}" received no value from ${edge.from.node}.${edge.from.port}`,
        )
      }
    }
    inputs[port.name] = value ?? port.default
  }
  return inputs
}

function resolveParams(def: NodeDefinition, given: Record<string, unknown>): PortValues {
  const params: PortValues = {}
  for (const param of def.params) params[param.name] = given[param.name] ?? param.default
  return params
}
