import { GraphValidationError } from '@anygen/core'
import type { H3Event } from 'h3'
import type { z } from 'zod'
import { ZodError } from 'zod'
import { AssetNotFoundError } from '../lib/assets'
import { RunRequestError } from '../lib/runs'

function toHttpError(err: unknown) {
  if (err instanceof GraphValidationError) {
    return createError({ statusCode: 422, statusMessage: 'Invalid graph', data: err.issues })
  }
  if (err instanceof ZodError) {
    return createError({ statusCode: 400, statusMessage: 'Invalid request', data: err.issues })
  }
  if (err instanceof RunRequestError) {
    return createError({ statusCode: 400, statusMessage: err.message })
  }
  if (err instanceof AssetNotFoundError) {
    return createError({ statusCode: 404, statusMessage: 'Asset not found' })
  }
  return err
}

/** `defineEventHandler` that maps domain errors (validation, not-found, …) to HTTP errors. */
export function defineApiHandler<T>(handler: (event: H3Event) => T | Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    } catch (err) {
      throw toHttpError(err)
    }
  })
}

export async function readJson<S extends z.ZodType>(
  event: H3Event,
  schema: S,
): Promise<z.output<S>> {
  return schema.parse(await readBody(event))
}

export function notFound(what: string): never {
  throw createError({ statusCode: 404, statusMessage: `${what} not found` })
}
