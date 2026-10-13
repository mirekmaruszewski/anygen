import type { GraphInput, NodeMeta, ParamDef } from '@anygen/core'

/**
 * Converts between Baklava's `editor.save()` state and AnyGen graph JSON. Pure data in, pure data
 * out (no Baklava imports) so it is testable without a DOM.
 */

/** Params live next to ports in a Baklava node's `inputs`; this prefix keeps the names apart. */
export const PARAM_PREFIX = 'param:'
export const paramKey = (name: string) => `${PARAM_PREFIX}${name}`

export interface BkInterfaceState {
  id: string
  value?: unknown
}

export interface BkNodeState {
  id: string
  type: string
  title: string
  inputs: Record<string, BkInterfaceState>
  outputs: Record<string, BkInterfaceState>
  position?: { x: number; y: number }
  width?: number
}

export interface BkEditorState {
  graph: {
    id: string
    nodes: BkNodeState[]
    connections: { id: string; from: string; to: string }[]
    inputs: unknown[]
    outputs: unknown[]
    panning?: { x: number; y: number }
    scaling?: number
  }
  graphTemplates: unknown[]
}

function decodeParam(param: ParamDef, raw: unknown): unknown {
  if (raw === undefined) return param.default
  switch (param.type) {
    case 'number':
    case 'slider':
      return typeof raw === 'number' ? raw : Number(raw)
    case 'asset':
      // An AssetRef object, or nothing selected yet.
      return raw && typeof raw === 'object' ? raw : undefined
    case 'json':
      if (typeof raw !== 'string') return raw
      if (!raw.trim()) return param.default
      try {
        return JSON.parse(raw)
      } catch {
        return raw // left as-is; the server reports the problem
      }
    default:
      return raw
  }
}

/** The inverse of `decodeParam`: the value the Baklava interface holds. */
export function encodeParam(param: ParamDef, value: unknown): unknown {
  const v = value ?? param.default
  switch (param.type) {
    case 'number':
    case 'slider':
      return typeof v === 'number' ? v : (param.min ?? 0)
    case 'boolean':
      return Boolean(v)
    case 'asset':
      return v && typeof v === 'object' ? v : null
    case 'json':
      return typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v, null, 2)
    case 'select': {
      const first = param.options?.[0]
      const fallback = typeof first === 'string' ? first : (first?.value ?? '')
      return v === undefined ? fallback : String(v)
    }
    default:
      return v === undefined ? '' : String(v)
  }
}

export function toGraph(state: BkEditorState, catalog: readonly NodeMeta[]): GraphInput {
  const metas = new Map(catalog.map((m) => [m.id, m]))
  const { nodes, connections } = state.graph

  const outputEnds = new Map<string, { node: string; port: string }>()
  const inputEnds = new Map<string, { node: string; port: string }>()
  for (const node of nodes) {
    for (const [port, intf] of Object.entries(node.outputs)) {
      outputEnds.set(intf.id, { node: node.id, port })
    }
    for (const [port, intf] of Object.entries(node.inputs)) {
      if (!port.startsWith(PARAM_PREFIX)) inputEnds.set(intf.id, { node: node.id, port })
    }
  }

  return {
    version: 1,
    nodes: nodes.map((n) => {
      const params: Record<string, unknown> = {}
      for (const p of metas.get(n.type)?.params ?? []) {
        const value = decodeParam(p, n.inputs[paramKey(p.name)]?.value)
        if (value !== undefined) params[p.name] = value
      }
      return {
        id: n.id,
        type: n.type,
        position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
        params,
      }
    }),
    edges: connections.flatMap((c) => {
      const from = outputEnds.get(c.from)
      const to = inputEnds.get(c.to)
      return from && to ? [{ from, to }] : []
    }),
  }
}

export interface FromGraphResult {
  state: BkEditorState
  /** Ids of nodes whose type is not in the catalog (they cannot be shown). */
  skipped: string[]
}

const inId = (node: string, port: string) => `${node}:in:${port}`
const outId = (node: string, port: string) => `${node}:out:${port}`

export function fromGraph(
  graph: GraphInput,
  catalog: readonly NodeMeta[],
  graphId = 'graph',
): FromGraphResult {
  const metas = new Map(catalog.map((m) => [m.id, m]))
  const skipped: string[] = []
  const nodes: BkNodeState[] = []

  for (const n of graph.nodes ?? []) {
    const meta = metas.get(n.type)
    if (!meta) {
      skipped.push(n.id)
      continue
    }
    const params = n.params ?? {}
    const inputs: Record<string, BkInterfaceState> = {}
    for (const p of meta.inputs) inputs[p.name] = { id: inId(n.id, p.name) }
    for (const p of meta.params) {
      inputs[paramKey(p.name)] = {
        id: inId(n.id, paramKey(p.name)),
        value: encodeParam(p, params[p.name]),
      }
    }
    const outputs: Record<string, BkInterfaceState> = {}
    for (const p of meta.outputs) outputs[p.name] = { id: outId(n.id, p.name) }
    nodes.push({
      id: n.id,
      type: n.type,
      title: meta.title,
      inputs,
      outputs,
      position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    })
  }

  const present = new Set(nodes.map((n) => n.id))
  const connections = (graph.edges ?? [])
    .filter((e) => present.has(e.from.node) && present.has(e.to.node))
    .map((e, i) => ({
      id: `c${i}:${e.from.node}.${e.from.port}>${e.to.node}.${e.to.port}`,
      from: outId(e.from.node, e.from.port),
      to: inId(e.to.node, e.to.port),
    }))

  return {
    state: {
      graph: {
        id: graphId,
        nodes,
        connections,
        inputs: [],
        outputs: [],
        panning: { x: 0, y: 0 },
        scaling: 1,
      },
      graphTemplates: [],
    },
    skipped,
  }
}
