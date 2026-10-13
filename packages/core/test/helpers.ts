import { NodeRegistry, defineNode, type GraphInput, type NodeDefinition } from '../src'

export interface Probe {
  /** Node ids in the order they started executing. */
  started: string[]
  /** Number of times each node type actually executed (cache hits excluded). */
  calls: Record<string, number>
}

export function createProbe(): Probe {
  return { started: [], calls: {} }
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Mock nodes covering sources, transforms, failures, slow work and type mismatches. */
export function mockNodes(probe: Probe, extra: NodeDefinition[] = []): NodeRegistry {
  const count = (id: string) => (probe.calls[id] = (probe.calls[id] ?? 0) + 1)

  const registry = new NodeRegistry()
  registry.registerAll([
    defineNode({
      id: 'test/const',
      title: 'Const',
      category: 'test',
      outputs: [{ name: 'out', type: 'number' }],
      params: [{ name: 'value', type: 'number', default: 0 }],
      execute: (ctx, _in, params) => {
        probe.started.push(ctx.nodeId)
        count('test/const')
        return { out: params.value }
      },
    }),
    defineNode({
      id: 'test/add',
      title: 'Add',
      category: 'test',
      inputs: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number', required: false, default: 0 },
      ],
      outputs: [{ name: 'sum', type: 'number' }],
      execute: (ctx, inputs) => {
        probe.started.push(ctx.nodeId)
        count('test/add')
        return { sum: (inputs.a as number) + (inputs.b as number) }
      },
    }),
    defineNode({
      id: 'test/text',
      title: 'Text',
      category: 'test',
      outputs: [{ name: 'out', type: 'text' }],
      params: [{ name: 'value', type: 'text', default: '' }],
      execute: (_ctx, _in, params) => ({ out: params.value }),
    }),
    defineNode({
      id: 'test/fail',
      title: 'Fail',
      category: 'test',
      inputs: [{ name: 'in', type: 'any', required: false }],
      outputs: [{ name: 'out', type: 'any' }],
      execute: (ctx) => {
        probe.started.push(ctx.nodeId)
        throw new Error('boom')
      },
    }),
    defineNode({
      id: 'test/random',
      title: 'Random',
      category: 'test',
      cache: false,
      outputs: [{ name: 'out', type: 'number' }],
      execute: () => {
        count('test/random')
        return { out: Math.random() }
      },
    }),
    ...extra,
  ])
  return registry
}

export const node = (id: string, type: string, params: Record<string, unknown> = {}) => ({
  id,
  type,
  params,
})

export const edge = (from: string, to: string, fromPort = 'out', toPort = 'in') => ({
  from: { node: from, port: fromPort },
  to: { node: to, port: toPort },
})

export const graph = (nodes: GraphInput['nodes'], edges: GraphInput['edges'] = []): GraphInput => ({
  nodes,
  edges,
})
