import { GraphSchema } from '@anygen/core'
import { z } from 'zod'

const Body = z.object({
  name: z.string().min(1).max(200).optional(),
  graph: GraphSchema.optional(),
})

export default defineApiHandler(async (event) => {
  const body = await readJson(event, Body)
  return useAnyGen().workflows.update(getRouterParam(event, 'id')!, body) ?? notFound('Workflow')
})
