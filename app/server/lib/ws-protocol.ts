import { GraphValidationError, type ExecutionEvent, type ValidationIssue } from '@anygen/core'
import { z } from 'zod'
import { RunRequestError, type RunManager } from './runs'

const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('run'),
    graph: z.unknown(),
    workflowId: z.string().optional(),
    targets: z.array(z.string()).optional(),
    /** Echoed back so the client can match `accepted`/`error` to its request. */
    requestId: z.string().optional(),
  }),
  z.object({ type: z.literal('cancel'), runId: z.string() }),
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>

export type ServerMessage =
  | { type: 'accepted'; runId: string; requestId?: string }
  | { type: 'event'; event: ExecutionEvent }
  | { type: 'cancelling'; runId: string; ok: boolean }
  | { type: 'error'; message: string; issues?: ValidationIssue[]; requestId?: string }

/**
 * One session per WebSocket peer. Messages in: `run` / `cancel`. Messages out: `accepted`,
 * `event` (every execution event of runs started by this peer), `cancelling`, `error`.
 */
export function createWsSession(runs: RunManager, send: (message: ServerMessage) => void) {
  const unsubscribes = new Set<() => void>()

  return {
    onMessage(raw: string) {
      let message: ClientMessage
      try {
        message = ClientMessageSchema.parse(JSON.parse(raw))
      } catch {
        send({ type: 'error', message: 'Invalid message' })
        return
      }

      if (message.type === 'cancel') {
        send({ type: 'cancelling', runId: message.runId, ok: runs.cancel(message.runId) })
        return
      }

      try {
        const { runId } = runs.start(message.graph, {
          workflowId: message.workflowId,
          targets: message.targets,
        })
        send({ type: 'accepted', runId, requestId: message.requestId })
        const off = runs.subscribe(runId, (event) => send({ type: 'event', event }))
        if (off) unsubscribes.add(off)
      } catch (err) {
        if (err instanceof GraphValidationError) {
          send({
            type: 'error',
            message: 'Invalid graph',
            issues: err.issues,
            requestId: message.requestId,
          })
        } else if (err instanceof RunRequestError || err instanceof z.ZodError) {
          send({
            type: 'error',
            message: err instanceof z.ZodError ? 'Malformed graph' : err.message,
            requestId: message.requestId,
          })
        } else {
          throw err
        }
      }
    },

    /** Stop streaming to this peer. Runs it started keep going (results are persisted). */
    close() {
      for (const off of unsubscribes) off()
      unsubscribes.clear()
    },
  }
}
