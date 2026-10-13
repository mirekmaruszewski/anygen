import { GraphSchema } from '@anygen/core'
import { z } from 'zod'

const Body = z.object({ name: z.string().min(1).max(200), graph: GraphSchema })

export default defineApiHandler(async (event) => {
  const body = await readJson(event, Body)
  setResponseStatus(event, 201)
  return useAnyGen().workflows.create(body)
})
