import { GraphSchema } from '@anygen/core'
import { z } from 'zod'

// Run an inline graph, or a saved workflow by id. `targets` runs only those nodes + dependencies.
const Body = z
  .object({
    graph: GraphSchema.optional(),
    workflowId: z.string().optional(),
    targets: z.array(z.string()).optional(),
  })
  .refine((b) => b.graph || b.workflowId, 'Provide `graph` or `workflowId`')

export default defineApiHandler(async (event) => {
  const body = await readJson(event, Body)
  const { runs, workflows } = useAnyGen()
  const graph = body.graph ?? workflows.get(body.workflowId!)?.graph ?? notFound('Workflow')
  const { runId } = runs.start(graph, { workflowId: body.workflowId, targets: body.targets })
  setResponseStatus(event, 202)
  return { runId }
})
