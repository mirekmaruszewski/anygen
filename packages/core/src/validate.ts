import { isPortCompatible } from './ports'
import { topologicalSort, type Graph } from './graph'
import type { NodeRegistry } from './registry'

export type ValidationCode =
  | 'duplicate-node'
  | 'unknown-node-type'
  | 'unknown-node'
  | 'unknown-port'
  | 'type-mismatch'
  | 'multiple-inputs'
  | 'missing-input'
  | 'cycle'

export interface ValidationIssue {
  code: ValidationCode
  message: string
  nodeId?: string
  port?: string
}

export class GraphValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(`Invalid graph:\n${issues.map((i) => `  - [${i.code}] ${i.message}`).join('\n')}`)
    this.name = 'GraphValidationError'
  }
}

const inputKey = (node: string, port: string) => `${node}:${port}`

export function validateGraph(graph: Graph, registry: NodeRegistry): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const nodes = new Map<string, Graph['nodes'][number]>()

  for (const node of graph.nodes) {
    if (nodes.has(node.id)) {
      issues.push({
        code: 'duplicate-node',
        nodeId: node.id,
        message: `Duplicate node id "${node.id}"`,
      })
      continue
    }
    nodes.set(node.id, node)
    if (!registry.has(node.type)) {
      issues.push({
        code: 'unknown-node-type',
        nodeId: node.id,
        message: `Node "${node.id}" has unknown type "${node.type}"`,
      })
    }
  }

  const connectedInputs = new Set<string>()
  for (const { from, to } of graph.edges) {
    const fromNode = nodes.get(from.node)
    const toNode = nodes.get(to.node)
    if (!fromNode || !toNode) {
      const missing = !fromNode ? from.node : to.node
      issues.push({
        code: 'unknown-node',
        nodeId: missing,
        message: `Edge references unknown node "${missing}"`,
      })
      continue
    }
    const fromDef = registry.get(fromNode.type)
    const toDef = registry.get(toNode.type)
    if (!fromDef || !toDef) continue // already reported as unknown-node-type

    const outPort = fromDef.outputs.find((p) => p.name === from.port)
    const inPort = toDef.inputs.find((p) => p.name === to.port)
    if (!outPort) {
      issues.push({
        code: 'unknown-port',
        nodeId: from.node,
        port: from.port,
        message: `Node "${from.node}" (${fromDef.id}) has no output "${from.port}"`,
      })
    }
    if (!inPort) {
      issues.push({
        code: 'unknown-port',
        nodeId: to.node,
        port: to.port,
        message: `Node "${to.node}" (${toDef.id}) has no input "${to.port}"`,
      })
    }
    if (!outPort || !inPort) continue

    const key = inputKey(to.node, to.port)
    if (connectedInputs.has(key)) {
      issues.push({
        code: 'multiple-inputs',
        nodeId: to.node,
        port: to.port,
        message: `Input "${to.port}" of node "${to.node}" has more than one incoming edge`,
      })
    }
    connectedInputs.add(key)

    if (!isPortCompatible(outPort.type, inPort.type)) {
      issues.push({
        code: 'type-mismatch',
        nodeId: to.node,
        port: to.port,
        message: `Cannot connect ${from.node}.${from.port} (${outPort.type}) to ${to.node}.${to.port} (${inPort.type})`,
      })
    }
  }

  for (const node of nodes.values()) {
    const def = registry.get(node.type)
    if (!def) continue
    for (const port of def.inputs) {
      const optional = !port.required || port.default !== undefined
      if (!optional && !connectedInputs.has(inputKey(node.id, port.name))) {
        issues.push({
          code: 'missing-input',
          nodeId: node.id,
          port: port.name,
          message: `Required input "${port.name}" of node "${node.id}" is not connected`,
        })
      }
    }
  }

  const { cyclic } = topologicalSort(graph)
  if (cyclic.length > 0) {
    issues.push({
      code: 'cycle',
      nodeId: cyclic[0],
      message: `Graph contains a cycle involving: ${cyclic.join(', ')}`,
    })
  }

  return issues
}

export function assertValidGraph(graph: Graph, registry: NodeRegistry): void {
  const issues = validateGraph(graph, registry)
  if (issues.length > 0) throw new GraphValidationError(issues)
}
