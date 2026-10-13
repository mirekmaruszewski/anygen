import type { Graph, NodeRegistry, ParamDef } from '@anygen/core'

export interface Override {
  nodeId: string
  param: string
  value: string
}

/** Parses `nodeId.param=value` (node ids may contain dots; the param is after the last one). */
export function parseOverride(spec: string): Override {
  const eq = spec.indexOf('=')
  const target = eq < 0 ? spec : spec.slice(0, eq)
  const dot = target.lastIndexOf('.')
  if (eq < 0 || dot <= 0 || dot === target.length - 1) {
    throw new Error(`Expected <nodeId>.<param>=<value>, got "${spec}"`)
  }
  return { nodeId: target.slice(0, dot), param: target.slice(dot + 1), value: spec.slice(eq + 1) }
}

/** Converts a command-line string to the value type the param expects. */
export function coerceParam(def: ParamDef, raw: string): unknown {
  switch (def.type) {
    case 'number':
    case 'slider': {
      const n = Number(raw)
      if (raw.trim() === '' || Number.isNaN(n)) throw new Error(`"${def.name}" needs a number`)
      return n
    }
    case 'boolean':
      if (raw === 'true' || raw === '1') return true
      if (raw === 'false' || raw === '0') return false
      throw new Error(`"${def.name}" needs true or false`)
    case 'json':
      try {
        return JSON.parse(raw)
      } catch {
        throw new Error(`"${def.name}" needs valid JSON`)
      }
    case 'asset':
      throw new Error(`"${def.name}" is a file param; use --asset`)
    default:
      return raw
  }
}

/** Returns a copy of the graph with the overrides applied. `resolve` maps a raw value to the param value. */
export async function applyOverrides(
  graph: Graph,
  registry: NodeRegistry,
  overrides: Override[],
  resolve: (def: ParamDef, raw: string) => Promise<unknown> | unknown,
): Promise<Graph> {
  const nodes = graph.nodes.map((n) => ({ ...n, params: { ...n.params } }))
  for (const { nodeId, param, value } of overrides) {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`No node "${nodeId}" in the workflow`)
    const def = registry.get(node.type)?.params.find((p) => p.name === param)
    if (!def) throw new Error(`Node "${nodeId}" (${node.type}) has no param "${param}"`)
    node.params[param] = await resolve(def, value)
  }
  return { ...graph, nodes }
}
