import { describe, expect, it } from 'vitest'
import { concatNode, textNode } from '@anygen/nodes'
import { toCatalogEntry, type NodeMeta } from '@anygen/core'
import { fromGraph, paramKey, toGraph } from '../utils/graphConvert'
import { applyEvent, emptyRunState } from '../utils/runState'

const catalog = [textNode, concatNode].map(toCatalogEntry)

const graph = {
  version: 1 as const,
  nodes: [
    { id: 'a', type: 'core/text', position: { x: 10, y: 20 }, params: { value: 'hello' } },
    { id: 'b', type: 'core/text', position: { x: 10, y: 120 }, params: { value: 'world' } },
    { id: 'c', type: 'core/concat', position: { x: 300, y: 60 }, params: { separator: ' ' } },
  ],
  edges: [
    { from: { node: 'a', port: 'text' }, to: { node: 'c', port: 'a' } },
    { from: { node: 'b', port: 'text' }, to: { node: 'c', port: 'b' } },
  ],
}

describe('graph conversion', () => {
  it('round-trips AnyGen graph -> Baklava state -> AnyGen graph', () => {
    const { state, skipped } = fromGraph(graph, catalog)
    expect(skipped).toEqual([])
    expect(toGraph(state, catalog)).toEqual(graph)
  })

  it('keeps params apart from ports', () => {
    const { state } = fromGraph(graph, catalog)
    const c = state.graph.nodes.find((n) => n.id === 'c')!
    expect(Object.keys(c.inputs).sort()).toEqual(['a', 'b', paramKey('separator')])
  })

  it('applies param defaults for missing params', () => {
    const { state } = fromGraph(
      { nodes: [{ id: 'x', type: 'core/concat', position: { x: 0, y: 0 }, params: {} }] },
      catalog,
    )
    expect(toGraph(state, catalog).nodes?.[0]?.params).toEqual({ separator: '\n' })
  })

  it('skips nodes of unknown type and the edges touching them', () => {
    const { state, skipped } = fromGraph(
      {
        nodes: [
          ...graph.nodes,
          { id: 'z', type: 'nope/missing', position: { x: 0, y: 0 }, params: {} },
        ],
        edges: [...graph.edges, { from: { node: 'z', port: 'out' }, to: { node: 'c', port: 'a' } }],
      },
      catalog,
    )
    expect(skipped).toEqual(['z'])
    expect(state.graph.connections).toHaveLength(2)
  })

  it('drops connections whose interfaces are not ports', () => {
    const { state } = fromGraph(graph, catalog)
    state.graph.connections.push({ id: 'bad', from: 'nope', to: 'c:in:a' })
    expect(toGraph(state, catalog).edges).toHaveLength(2)
  })

  it('passes unknown node types through so the server can report them', () => {
    const { state } = fromGraph(graph, catalog)
    state.graph.nodes.push({ id: 'q', type: 'ghost', title: 'g', inputs: {}, outputs: {} })
    expect(toGraph(state, catalog).nodes?.map((n) => n.type)).toContain('ghost')
  })
})

describe('run state', () => {
  it('tracks a run through its events', () => {
    let s = emptyRunState()
    s = applyEvent(s, { type: 'run:start', runId: 'r', nodeIds: ['a', 'b'] })
    expect(s.nodes.a?.status).toBe('queued')
    s = applyEvent(s, { type: 'node:start', runId: 'r', nodeId: 'a' })
    s = applyEvent(s, {
      type: 'node:progress',
      runId: 'r',
      nodeId: 'a',
      progress: { fraction: 0.5 },
    })
    expect(s.nodes.a).toMatchObject({ status: 'running', progress: { fraction: 0.5 } })
    s = applyEvent(s, {
      type: 'node:done',
      runId: 'r',
      nodeId: 'a',
      outputs: { text: 'x' },
      cached: true,
    })
    expect(s.nodes.a).toMatchObject({ status: 'cached', outputs: { text: 'x' } })
    s = applyEvent(s, { type: 'node:error', runId: 'r', nodeId: 'b', error: 'boom' })
    s = applyEvent(s, { type: 'run:done', runId: 'r', status: 'error', results: {} })
    expect(s).toMatchObject({ running: false, finished: 'error' })
    expect(s.nodes.b?.error).toBe('boom')
  })

  it('ignores events of other runs', () => {
    const s = applyEvent(emptyRunState(), { type: 'node:start', runId: 'other', nodeId: 'a' })
    expect(s).toEqual(emptyRunState())
  })

  it('fills in statuses missing from the stream when the run finishes', () => {
    let s = applyEvent(emptyRunState(), { type: 'run:start', runId: 'r', nodeIds: ['a'] })
    s = applyEvent(s, {
      type: 'run:done',
      runId: 'r',
      status: 'cancelled',
      results: { a: { status: 'cancelled' } },
    })
    expect(s.nodes.a?.status).toBe('cancelled')
  })
})

describe('asset params', () => {
  const meta = {
    id: 'core/load-image',
    title: 'Load Image',
    category: 'Input',
    version: 1,
    cache: true,
    inputs: [],
    outputs: [{ name: 'image', type: 'image', required: true }],
    params: [{ name: 'file', type: 'asset', accept: 'image/*' }],
  } as unknown as NodeMeta
  const ref = { assetId: 'a'.repeat(64), mime: 'image/png', name: 'p.png', size: 3 }

  it('round-trips an asset reference through the editor state', () => {
    const graph = {
      version: 1 as const,
      nodes: [{ id: 'n', type: meta.id, params: { file: ref } }],
      edges: [],
    }
    const { state } = fromGraph(graph, [meta])
    expect(state.graph.nodes[0]!.inputs['param:file']!.value).toEqual(ref)
    expect(toGraph(state, [meta]).nodes?.[0]?.params).toEqual({ file: ref })
  })

  it('omits the param while nothing is selected', () => {
    const graph = {
      version: 1 as const,
      nodes: [{ id: 'n', type: meta.id, params: {} }],
      edges: [],
    }
    const { state } = fromGraph(graph, [meta])
    expect(state.graph.nodes[0]!.inputs['param:file']!.value).toBeNull()
    expect(toGraph(state, [meta]).nodes?.[0]?.params).toEqual({})
  })
})
