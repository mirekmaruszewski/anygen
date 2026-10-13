import type { NodeProgress, PortValues } from './types'

export type RunStatus = 'done' | 'error' | 'cancelled'
export type NodeStatus = 'done' | 'error' | 'skipped' | 'cancelled'

export interface NodeResult {
  status: NodeStatus
  outputs?: PortValues
  /** Present when `status` is `error`. */
  error?: string
  /** True when outputs came from the cache instead of running the node. */
  cached?: boolean
  /** Present when `status` is `skipped`: the upstream node whose failure caused it. */
  blockedBy?: string
}

export type ExecutionEvent =
  | { type: 'run:start'; runId: string; nodeIds: string[] }
  | { type: 'node:start'; runId: string; nodeId: string }
  | { type: 'node:progress'; runId: string; nodeId: string; progress: NodeProgress }
  | { type: 'node:done'; runId: string; nodeId: string; outputs: PortValues; cached: boolean }
  | { type: 'node:error'; runId: string; nodeId: string; error: string }
  | { type: 'node:skipped'; runId: string; nodeId: string; blockedBy: string }
  | { type: 'node:cancelled'; runId: string; nodeId: string }
  | { type: 'run:done'; runId: string; status: RunStatus; results: Record<string, NodeResult> }

export type ExecutionListener = (event: ExecutionEvent) => void
