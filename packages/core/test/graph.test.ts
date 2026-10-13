import { describe, expect, it } from 'vitest'
import {
  GraphValidationError,
  defineNode,
  isPortCompatible,
  isPortType,
  parseGraph,
  topologicalSort,
  validateGraph,
  NodeRegistry,
} from '../src'
import { createProbe, edge, graph, mockNodes, node } from './helpers'

const registry = mockNodes(createProbe())
const codes = (g: ReturnType<typeof graph>) =>
  validateGraph(parseGraph(g), registry).map((i) => i.code)

describe('port types', () => {
  it('recognises base and list types', () => {
    expect(isPortType('text')).toBe(true)
    expect(isPortType('list<image>')).toBe(true)
    expect(isPortType('list<list<number>>')).toBe(true)
    expect(isPortType('list<bogus>')).toBe(false)
    expect(isPortType('string')).toBe(false)
  })

  it('checks compatibility', () => {
    expect(isPortCompatible('text', 'text')).toBe(true)
    expect(isPortCompatible('text', 'number')).toBe(false)
    expect(isPortCompatible('image', 'any')).toBe(true)
    expect(isPortCompatible('any', 'image')).toBe(true)
    expect(isPortCompatible('list<text>', 'list<text>')).toBe(true)
    expect(isPortCompatible('list<text>', 'list<any>')).toBe(true)
    expect(isPortCompatible('list<text>', 'list<number>')).toBe(false)
    expect(isPortCompatible('text', 'list<text>')).toBe(false)
  })
})

describe('defineNode / registry', () => {
  it('applies defaults and rejects bad definitions', () => {
    const def = defineNode({ id: 'x', title: 'X', category: 'c', execute: () => ({}) })
    expect(def).toMatchObject({ inputs: [], outputs: [], params: [], cache: true, version: 1 })
    expect(() =>
      defineNode({
        id: 'x',
        title: 'X',
        category: 'c',
        inputs: [
          { name: 'a', type: 'text' },
          { name: 'a', type: 'text' },
        ],
        execute: () => ({}),
      }),
    ).toThrow(/Duplicate input/)
    expect(() =>
      defineNode({
        id: 'x',
        title: 'X',
        category: 'c',
        inputs: [{ name: 'a', type: 'nope' as never }],
        execute: () => ({}),
      }),
    ).toThrow()
    expect(() =>
      defineNode({
        id: 'x',
        title: 'X',
        category: 'c',
        params: [{ name: 'p', type: 'select' }],
        execute: () => ({}),
      }),
    ).toThrow(/option/)
  })

  it('rejects duplicate registration and serves a function-free catalog', () => {
    const reg = new NodeRegistry()
    const def = defineNode({ id: 'x', title: 'X', category: 'c', execute: () => ({}) })
    reg.register(def)
    expect(() => reg.register(def)).toThrow(/already registered/)
    expect(reg.get('x')).toBe(def)
    expect(JSON.parse(JSON.stringify(reg.catalog()))[0]).not.toHaveProperty('execute')
  })
})

describe('parseGraph', () => {
  it('fills defaults', () => {
    expect(parseGraph({ nodes: [{ id: 'a', type: 'test/const' }] })).toEqual({
      version: 1,
      nodes: [{ id: 'a', type: 'test/const', position: { x: 0, y: 0 }, params: {} }],
      edges: [],
    })
  })

  it('rejects unsupported versions', () => {
    expect(() => parseGraph({ version: 99, nodes: [] })).toThrow()
  })
})

describe('topologicalSort', () => {
  it('orders dependencies first', () => {
    const g = parseGraph(
      graph(
        [node('c', 'test/add'), node('a', 'test/const'), node('b', 'test/const')],
        [edge('a', 'c', 'out', 'a'), edge('b', 'c', 'out', 'b')],
      ),
    )
    const { order, cyclic } = topologicalSort(g)
    expect(cyclic).toEqual([])
    expect(order.indexOf('c')).toBeGreaterThan(order.indexOf('a'))
    expect(order.indexOf('c')).toBeGreaterThan(order.indexOf('b'))
  })

  it('reports cyclic nodes', () => {
    const g = parseGraph(
      graph(
        [node('a', 'test/add'), node('b', 'test/add'), node('ok', 'test/const')],
        [edge('a', 'b', 'sum', 'a'), edge('b', 'a', 'sum', 'a')],
      ),
    )
    const { order, cyclic } = topologicalSort(g)
    expect(order).toEqual(['ok'])
    expect(cyclic.sort()).toEqual(['a', 'b'])
  })
})

describe('validateGraph', () => {
  it('accepts a valid graph', () => {
    expect(
      codes(graph([node('a', 'test/const'), node('b', 'test/add')], [edge('a', 'b', 'out', 'a')])),
    ).toEqual([])
  })

  it('detects cycles', () => {
    const g = graph(
      [node('a', 'test/add'), node('b', 'test/add')],
      [edge('a', 'b', 'sum', 'a'), edge('b', 'a', 'sum', 'a')],
    )
    expect(codes(g)).toContain('cycle')
  })

  it('detects type mismatches', () => {
    const g = graph(
      [node('t', 'test/text'), node('add', 'test/add')],
      [edge('t', 'add', 'out', 'a')],
    )
    expect(codes(g)).toEqual(['type-mismatch'])
  })

  it('detects missing required inputs but allows optional/default ones', () => {
    const issues = validateGraph(parseGraph(graph([node('add', 'test/add')])), registry)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'missing-input', nodeId: 'add', port: 'a' })
  })

  it('detects unknown types, nodes, ports, duplicates and fan-in', () => {
    expect(codes(graph([node('a', 'nope/nope')]))).toEqual(['unknown-node-type'])
    expect(codes(graph([node('a', 'test/const'), node('a', 'test/const')]))).toContain(
      'duplicate-node',
    )
    expect(codes(graph([node('a', 'test/const')], [edge('a', 'ghost')]))).toEqual(['unknown-node'])
    expect(
      codes(
        graph([node('a', 'test/const'), node('b', 'test/add')], [edge('a', 'b', 'out', 'zzz')]),
      ),
    ).toContain('unknown-port')
    expect(
      codes(
        graph(
          [node('a', 'test/const'), node('b', 'test/const'), node('c', 'test/add')],
          [edge('a', 'c', 'out', 'a'), edge('b', 'c', 'out', 'a')],
        ),
      ),
    ).toContain('multiple-inputs')
  })

  it('exposes issues on GraphValidationError', () => {
    const err = new GraphValidationError(
      validateGraph(parseGraph(graph([node('a', 'x/y')])), registry),
    )
    expect(err.issues[0]?.code).toBe('unknown-node-type')
    expect(err.message).toContain('unknown type')
  })
})
