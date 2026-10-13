import { z } from 'zod'

export const GRAPH_VERSION = 1

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  /** A registered node definition id. */
  type: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  params: z.record(z.string(), z.unknown()).default({}),
})
export type GraphNode = z.infer<typeof GraphNodeSchema>

const EndpointSchema = z.object({ node: z.string().min(1), port: z.string().min(1) })

export const GraphEdgeSchema = z.object({ from: EndpointSchema, to: EndpointSchema })
export type GraphEdge = z.infer<typeof GraphEdgeSchema>

export const GraphSchema = z.object({
  version: z.literal(GRAPH_VERSION).default(GRAPH_VERSION),
  nodes: z.array(GraphNodeSchema).default([]),
  edges: z.array(GraphEdgeSchema).default([]),
})
export type Graph = z.infer<typeof GraphSchema>
export type GraphInput = z.input<typeof GraphSchema>

export function parseGraph(input: unknown): Graph {
  return GraphSchema.parse(input)
}

/**
 * Kahn's algorithm. `order` holds every node that can be ordered; `cyclic` holds the nodes that
 * could not be (members of a cycle, or downstream of one). Edges that reference unknown nodes
 * are ignored.
 */
export function topologicalSort(graph: Graph): { order: string[]; cyclic: string[] } {
  const ids = new Set(graph.nodes.map((n) => n.id))
  const indegree = new Map<string, number>([...ids].map((id) => [id, 0]))
  const downstream = new Map<string, string[]>()

  for (const { from, to } of graph.edges) {
    if (!ids.has(from.node) || !ids.has(to.node)) continue
    indegree.set(to.node, (indegree.get(to.node) ?? 0) + 1)
    downstream.set(from.node, [...(downstream.get(from.node) ?? []), to.node])
  }

  const queue = graph.nodes.map((n) => n.id).filter((id) => indegree.get(id) === 0)
  const order: string[] = []
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!
    order.push(id)
    for (const next of downstream.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  const ordered = new Set(order)
  return { order, cyclic: graph.nodes.map((n) => n.id).filter((id) => !ordered.has(id)) }
}
