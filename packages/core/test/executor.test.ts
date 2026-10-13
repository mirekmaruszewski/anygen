import { describe, expect, it } from 'vitest'
import {
  Executor,
  GraphValidationError,
  MemoryCache,
  defineNode,
  type ExecutionEvent,
} from '../src'
import { createProbe, deferred, edge, graph, mockNodes, node } from './helpers'

/** const(2) + const(3) -> add -> add(+ const 10) */
const arithmetic = () =>
  graph(
    [
      node('two', 'test/const', { value: 2 }),
      node('three', 'test/const', { value: 3 }),
      node('add1', 'test/add'),
      node('ten', 'test/const', { value: 10 }),
      node('add2', 'test/add'),
    ],
    [
      edge('two', 'add1', 'out', 'a'),
      edge('three', 'add1', 'out', 'b'),
      edge('add1', 'add2', 'sum', 'a'),
      edge('ten', 'add2', 'out', 'b'),
    ],
  )

describe('Executor basics', () => {
  it('resolves inputs and returns outputs of every node', async () => {
    const probe = createProbe()
    const result = await new Executor(mockNodes(probe)).run(arithmetic())
    expect(result.status).toBe('done')
    expect(result.results.add1?.outputs).toEqual({ sum: 5 })
    expect(result.results.add2?.outputs).toEqual({ sum: 15 })
  })

  it('runs dependencies before dependents', async () => {
    const probe = createProbe()
    await new Executor(mockNodes(probe)).run(arithmetic())
    const at = (id: string) => probe.started.indexOf(id)
    expect(at('add1')).toBeGreaterThan(at('two'))
    expect(at('add1')).toBeGreaterThan(at('three'))
    expect(at('add2')).toBeGreaterThan(at('add1'))
    expect(at('add2')).toBeGreaterThan(at('ten'))
  })

  it('uses param and port defaults', async () => {
    const result = await new Executor(mockNodes(createProbe())).run(
      graph([node('c', 'test/const'), node('a', 'test/add')], [edge('c', 'a', 'out', 'a')]),
    )
    expect(result.results.c?.outputs).toEqual({ out: 0 })
    expect(result.results.a?.outputs).toEqual({ sum: 0 })
  })

  it('rejects invalid graphs before running anything', async () => {
    const probe = createProbe()
    await expect(
      new Executor(mockNodes(probe)).run(graph([node('add', 'test/add')])),
    ).rejects.toBeInstanceOf(GraphValidationError)
    expect(probe.started).toEqual([])
  })

  it('emits events in a sensible order', async () => {
    const executor = new Executor(mockNodes(createProbe()))
    const events: ExecutionEvent[] = []
    executor.on((e) => events.push(e))
    await executor.run(graph([node('a', 'test/const', { value: 1 })]))
    expect(events.map((e) => e.type)).toEqual(['run:start', 'node:start', 'node:done', 'run:done'])
  })

  it('survives throwing listeners and supports unsubscribe', async () => {
    const executor = new Executor(mockNodes(createProbe()))
    let calls = 0
    const off = executor.on(() => {
      calls++
      throw new Error('listener bug')
    })
    const g = graph([node('a', 'test/const')])
    await expect(executor.run(g)).resolves.toMatchObject({ status: 'done' })
    const before = calls
    off()
    await executor.run(g)
    expect(calls).toBe(before)
  })
})

describe('parallelism', () => {
  it('runs independent branches concurrently', async () => {
    // Each node waits until both have started: this only completes if they overlap.
    const barrier = deferred()
    let arrived = 0
    const gate = defineNode({
      id: 'test/gate',
      title: 'Gate',
      category: 'test',
      outputs: [{ name: 'out', type: 'number' }],
      execute: async () => {
        if (++arrived === 2) barrier.resolve()
        await barrier.promise
        return { out: 1 }
      },
    })
    const executor = new Executor(mockNodes(createProbe(), [gate]))
    const run = executor.run(graph([node('x', 'test/gate'), node('y', 'test/gate')]))
    const result = await Promise.race([
      run,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('ran serially')), 1000)),
    ])
    expect(result.status).toBe('done')
  })

  it('honours maxConcurrency', async () => {
    let active = 0
    let peak = 0
    const slow = defineNode({
      id: 'test/slow',
      title: 'Slow',
      category: 'test',
      outputs: [{ name: 'out', type: 'number' }],
      execute: async () => {
        peak = Math.max(peak, ++active)
        await new Promise((r) => setTimeout(r, 20))
        active--
        return { out: 1 }
      },
    })
    const executor = new Executor(mockNodes(createProbe(), [slow]), { maxConcurrency: 2 })
    await executor.run(graph(['a', 'b', 'c', 'd'].map((id) => node(id, 'test/slow'))))
    expect(peak).toBe(2)
  })
})

describe('caching', () => {
  it('skips unchanged nodes on re-run', async () => {
    const probe = createProbe()
    const executor = new Executor(mockNodes(probe))
    await executor.run(arithmetic())
    expect(probe.calls['test/add']).toBe(2)

    const second = await executor.run(arithmetic())
    expect(probe.calls['test/add']).toBe(2)
    expect(probe.calls['test/const']).toBe(3)
    expect(Object.values(second.results).every((r) => r.cached)).toBe(true)
  })

  it('re-runs only the changed node and its dependents', async () => {
    const probe = createProbe()
    const executor = new Executor(mockNodes(probe))
    await executor.run(arithmetic())

    const changed = arithmetic()
    ;(changed.nodes as { id: string; params: Record<string, unknown> }[]).find(
      (n) => n.id === 'ten',
    )!.params.value = 20
    const result = await executor.run(changed)

    expect(result.results.add2?.outputs).toEqual({ sum: 25 })
    expect(result.results.two?.cached).toBe(true)
    expect(result.results.three?.cached).toBe(true)
    expect(result.results.add1?.cached).toBe(true)
    expect(result.results.ten?.cached).toBe(false)
    expect(result.results.add2?.cached).toBe(false)
  })

  it('never caches nodes with cache: false', async () => {
    const probe = createProbe()
    const executor = new Executor(mockNodes(probe))
    const g = graph([node('r', 'test/random')])
    const a = await executor.run(g)
    const b = await executor.run(g)
    expect(probe.calls['test/random']).toBe(2)
    expect(a.results.r?.outputs).not.toEqual(b.results.r?.outputs)
  })

  it('can share a cache between executors and be cleared', async () => {
    const probe = createProbe()
    const cache = new MemoryCache()
    const registry = mockNodes(probe)
    await new Executor(registry, { cache }).run(arithmetic())
    await new Executor(registry, { cache }).run(arithmetic())
    expect(probe.calls['test/add']).toBe(2)
    cache.clear()
    await new Executor(registry, { cache }).run(arithmetic())
    expect(probe.calls['test/add']).toBe(4)
  })

  it('invalidates when the node version changes', async () => {
    const cache = new MemoryCache()
    const make = (version: number) =>
      new Executor(
        mockNodes(createProbe(), [
          defineNode({
            id: 'test/versioned',
            title: 'V',
            category: 'test',
            version,
            outputs: [{ name: 'out', type: 'number' }],
            execute: () => ({ out: version }),
          }),
        ]),
        { cache },
      )
    const g = graph([node('v', 'test/versioned')])
    expect((await make(1).run(g)).results.v?.outputs).toEqual({ out: 1 })
    expect((await make(2).run(g)).results.v?.outputs).toEqual({ out: 2 })
  })
})

describe('error isolation', () => {
  it('skips dependents of a failed node but finishes sibling branches', async () => {
    const probe = createProbe()
    const executor = new Executor(mockNodes(probe))
    const events: ExecutionEvent[] = []
    executor.on((e) => events.push(e))

    const result = await executor.run(
      graph(
        [
          node('bad', 'test/fail'),
          node('after', 'test/fail'),
          node('after2', 'test/fail'),
          node('ok', 'test/const', { value: 4 }),
          node('okAdd', 'test/add'),
        ],
        [edge('bad', 'after'), edge('after', 'after2'), edge('ok', 'okAdd', 'out', 'a')],
      ),
    )

    expect(result.status).toBe('error')
    expect(result.results.bad).toMatchObject({ status: 'error', error: 'boom' })
    expect(result.results.after).toMatchObject({ status: 'skipped', blockedBy: 'bad' })
    expect(result.results.after2).toMatchObject({ status: 'skipped', blockedBy: 'bad' })
    expect(result.results.okAdd).toMatchObject({ status: 'done', outputs: { sum: 4 } })
    expect(probe.started).not.toContain('after')
    expect(events.filter((e) => e.type === 'node:skipped')).toHaveLength(2)
  })

  it('turns a missing upstream output into a node error', async () => {
    const empty = defineNode({
      id: 'test/empty',
      title: 'Empty',
      category: 'test',
      outputs: [{ name: 'out', type: 'number' }],
      execute: () => ({}),
    })
    const result = await new Executor(mockNodes(createProbe(), [empty])).run(
      graph([node('e', 'test/empty'), node('a', 'test/add')], [edge('e', 'a', 'out', 'a')]),
    )
    expect(result.results.a?.status).toBe('error')
    expect(result.results.a?.error).toMatch(/received no value/)
  })

  it('errors when a node returns a non-object', async () => {
    const bad = defineNode({
      id: 'test/bad-return',
      title: 'Bad',
      category: 'test',
      execute: () => 'nope' as never,
    })
    const result = await new Executor(mockNodes(createProbe(), [bad])).run(
      graph([node('b', 'test/bad-return')]),
    )
    expect(result.results.b?.error).toMatch(/must return an object/)
  })
})

describe('progress', () => {
  it('forwards progress updates as events', async () => {
    const streaming = defineNode({
      id: 'test/stream',
      title: 'Stream',
      category: 'test',
      outputs: [{ name: 'out', type: 'text' }],
      execute: (ctx) => {
        ctx.progress({ partial: 'he' })
        ctx.progress({ partial: 'hello', fraction: 1 })
        return { out: 'hello' }
      },
    })
    const executor = new Executor(mockNodes(createProbe(), [streaming]))
    const partials: unknown[] = []
    executor.on((e) => e.type === 'node:progress' && partials.push(e.progress.partial))
    await executor.run(graph([node('s', 'test/stream')]))
    expect(partials).toEqual(['he', 'hello'])
  })

  it('passes services to nodes', async () => {
    const svc = defineNode({
      id: 'test/svc',
      title: 'Svc',
      category: 'test',
      outputs: [{ name: 'out', type: 'text' }],
      execute: (ctx) => ({ out: (ctx.services.greeting as string) + '!' }),
    })
    const result = await new Executor(mockNodes(createProbe(), [svc])).run(
      graph([node('s', 'test/svc')]),
      { services: { greeting: 'hi' } },
    )
    expect(result.results.s?.outputs).toEqual({ out: 'hi!' })
  })
})

describe('run targets', () => {
  it('runs only the targets and their ancestors', async () => {
    const probe = createProbe()
    const result = await new Executor(mockNodes(probe)).run(arithmetic(), { targets: ['add1'] })
    expect(Object.keys(result.results).sort()).toEqual(['add1', 'three', 'two'])
    expect(probe.started).not.toContain('ten')
    expect(probe.started).not.toContain('add2')
  })

  it('rejects unknown targets', async () => {
    await expect(
      new Executor(mockNodes(createProbe())).run(arithmetic(), { targets: ['ghost'] }),
    ).rejects.toThrow(/Unknown run target/)
  })
})

describe('cancellation', () => {
  /** Resolves only when its signal aborts. */
  const hang = defineNode({
    id: 'test/hang',
    title: 'Hang',
    category: 'test',
    inputs: [{ name: 'in', type: 'any', required: false }],
    outputs: [{ name: 'out', type: 'number' }],
    execute: (ctx) =>
      new Promise((_, reject) => {
        ctx.signal.addEventListener('abort', () => reject(new Error('aborted by node')))
      }),
  })

  it('cancels running and pending nodes while keeping finished results', async () => {
    const probe = createProbe()
    const executor = new Executor(mockNodes(probe, [hang]))
    const started = deferred()
    executor.on((e) => e.type === 'node:start' && e.nodeId === 'h' && started.resolve())

    const controller = new AbortController()
    const run = executor.run(
      graph(
        [node('c', 'test/const', { value: 1 }), node('h', 'test/hang'), node('after', 'test/add')],
        [edge('h', 'after', 'out', 'a')],
      ),
      { signal: controller.signal },
    )
    await started.promise
    controller.abort()
    const result = await run

    expect(result.status).toBe('cancelled')
    expect(result.results.c?.status).toBe('done')
    expect(result.results.h?.status).toBe('cancelled')
    expect(result.results.after?.status).toBe('cancelled')
    expect(probe.started).not.toContain('after')
  })

  it('returns promptly even if a node ignores the signal', async () => {
    const stubborn = defineNode({
      id: 'test/stubborn',
      title: 'Stubborn',
      category: 'test',
      outputs: [{ name: 'out', type: 'number' }],
      execute: () => new Promise(() => {}),
    })
    const executor = new Executor(mockNodes(createProbe(), [stubborn]))
    const controller = new AbortController()
    const started = deferred()
    executor.on((e) => e.type === 'node:start' && started.resolve())
    const run = executor.run(graph([node('s', 'test/stubborn')]), { signal: controller.signal })
    await started.promise
    controller.abort()
    expect((await run).results.s?.status).toBe('cancelled')
  })

  it('does not start anything when already aborted', async () => {
    const probe = createProbe()
    const controller = new AbortController()
    controller.abort()
    const result = await new Executor(mockNodes(probe)).run(arithmetic(), {
      signal: controller.signal,
    })
    expect(result.status).toBe('cancelled')
    expect(probe.started).toEqual([])
    expect(Object.values(result.results).every((r) => r.status === 'cancelled')).toBe(true)
  })

  it('does not cache cancelled work', async () => {
    const probe = createProbe()
    const executor = new Executor(mockNodes(probe, [hang]))
    const controller = new AbortController()
    controller.abort()
    await executor.run(arithmetic(), { signal: controller.signal })
    const result = await executor.run(arithmetic())
    expect(result.status).toBe('done')
    expect(Object.values(result.results).some((r) => r.cached)).toBe(false)
  })
})
