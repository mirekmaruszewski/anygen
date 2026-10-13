import { generateText, jsonSchema, Output, streamText, type ModelMessage } from 'ai'
import { z } from 'zod'
import type { ExecutionContext } from '@anygen/core'
import { getModels } from './models'

/** How often streamed text is pushed to the UI. */
const PARTIAL_INTERVAL_MS = 150

export interface TextCall {
  ctx: ExecutionContext
  model: string
  system?: string
  messages: ModelMessage[]
  temperature?: number
  maxOutputTokens?: number
}

const clean = (system: string | undefined) => (system?.trim() ? system : undefined)

/** Streams a completion, forwarding the text so far as progress (`partial`). Returns the full text. */
export async function runText(call: TextCall): Promise<string> {
  const { ctx } = call
  const result = streamText({
    model: getModels(ctx).language(call.model),
    system: clean(call.system),
    messages: call.messages,
    temperature: call.temperature,
    maxOutputTokens: call.maxOutputTokens,
    abortSignal: ctx.signal,
  })

  let text = ''
  let lastPush = 0
  for await (const part of result.fullStream) {
    if (part.type === 'error') throw part.error
    if (part.type !== 'text-delta') continue
    text += part.text
    const now = Date.now()
    if (now - lastPush >= PARTIAL_INTERVAL_MS) {
      lastPush = now
      ctx.progress({ partial: text })
    }
  }
  ctx.progress({ partial: text })
  return text
}

export interface StructuredCall extends Omit<TextCall, 'maxOutputTokens'> {
  /** A Zod schema, or a plain JSON Schema object. */
  schema: z.ZodType | Record<string, unknown>
  /** Extra attempts when the model's output fails validation. */
  retries?: number
  /** Extra checks the schema cannot express; throw to reject the output (it is retried). */
  validate?: (output: unknown) => void
}

/**
 * Structured output via `generateText` + `Output.object`. If the output does not match the schema
 * the model gets one more try with the validation error appended.
 */
export async function runStructured<T = unknown>(call: StructuredCall): Promise<T> {
  const { ctx } = call
  const model = getModels(ctx).language(call.model)
  const schema = isZod(call.schema) ? call.schema : toSchema(call.schema)
  let messages = call.messages
  let lastError: unknown

  for (let attempt = 0; attempt <= (call.retries ?? 1); attempt++) {
    if (ctx.signal.aborted) throw new Error('Cancelled')
    ctx.progress({ message: attempt ? `Retrying (${attempt})…` : 'Generating…' })
    try {
      const { output } = await generateText({
        model,
        system: clean(call.system),
        messages,
        temperature: call.temperature,
        output: Output.object({ schema }),
        abortSignal: ctx.signal,
      })
      call.validate?.(output)
      return output as T
    } catch (err) {
      if (ctx.signal.aborted) throw err
      lastError = err
      messages = [
        ...call.messages,
        {
          role: 'user',
          content: `Your previous answer was rejected: ${errorMessage(err)}\nAnswer again, following the schema exactly.`,
        },
      ]
    }
  }
  throw lastError
}

const isZod = (s: unknown): s is z.ZodType => typeof (s as z.ZodType)?.safeParse === 'function'

/** Prefers a validating Zod schema; falls back to an unvalidated JSON Schema for exotic features. */
function toSchema(raw: Record<string, unknown>) {
  try {
    return z.fromJSONSchema(raw as Parameters<typeof z.fromJSONSchema>[0])
  } catch {
    return jsonSchema(raw as Parameters<typeof jsonSchema>[0])
  }
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))
