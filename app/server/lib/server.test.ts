import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { concatNode, textNode } from '@anygen/nodes'
import {
  GraphValidationError,
  defineNode,
  type ExecutionEvent,
  type GraphInput,
} from '@anygen/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssetNotFoundError } from './assets'
import { createAnyGen, type AnyGen } from './context'
import { openDb } from './db'
import { RunRequestError } from './runs'
import { createWsSession, type ServerMessage } from './ws-protocol'

let dir: string
let app: AnyGen
let executions: number

const hang = defineNode({
  id: 'test/hang',
  title: 'Hang',
  category: 'test',
  outputs: [{ name: 'text', type: 'text' }],
  cache: false,
  execute: (ctx) =>
    new Promise((_, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))
    }),
})

const counter = defineNode({
  id: 'test/counted',
  title: 'Counted',
  category: 'test',
  outputs: [{ name: 'text', type: 'text' }],
  execute: () => {
    executions++
    return { text: 'x' }
  },
})

const make = (env: Record<string, string | undefined> = {}) =>
  createAnyGen({
    dataDir: dir,
    dbFile: ':memory:',
    env,
    nodes: [textNode, concatNode, hang, counter],
  })

const greeting = (): GraphInput => ({
  nodes: [
    { id: 'a', type: 'core/text', params: { value: 'Hello' } },
    { id: 'b', type: 'core/text', params: { value: 'world' } },
    { id: 'c', type: 'core/concat', params: { separator: ', ' } },
  ],
  edges: [
    { from: { node: 'a', port: 'text' }, to: { node: 'c', port: 'a' } },
    { from: { node: 'b', port: 'text' }, to: { node: 'c', port: 'b' } },
  ],
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anygen-test-'))
  executions = 0
  app = make()
})

afterEach(() => {
  app.db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('workflows', () => {
  it('supports create, read, update, list and delete', () => {
    const { workflows } = app
    const graph = { version: 1 as const, nodes: [], edges: [] }
    const created = workflows.create({ name: 'First', graph })
    expect(workflows.get(created.id)).toEqual(created)

    const updated = workflows.update(created.id, { name: 'Renamed' })!
    expect(updated.name).toBe('Renamed')
    expect(updated.graph).toEqual(graph)
    expect(workflows.list().map((w) => w.name)).toEqual(['Renamed'])

    expect(workflows.update('missing', { name: 'x' })).toBeUndefined()
    expect(workflows.remove(created.id)).toBe(true)
    expect(workflows.remove(created.id)).toBe(false)
    expect(workflows.get(created.id)).toBeUndefined()
  })
})

describe('assets', () => {
  it('stores bytes content-addressed and reads them back', async () => {
    const data = new TextEncoder().encode('page scan')
    const ref = await app.assets.save(data, { name: 'page.png', mime: 'image/png' })
    expect(ref).toMatchObject({ name: 'page.png', mime: 'image/png', size: data.byteLength })
    expect(ref.assetId).toMatch(/^[0-9a-f]{64}$/)

    const again = await app.assets.save(data, { name: 'copy.png', mime: 'image/png' })
    expect(again).toEqual(ref) // same content, same ref (so cache keys stay stable)

    const read = await app.assets.read(ref.assetId)
    expect(new TextDecoder().decode(read.data)).toBe('page scan')
    expect(read.ref).toEqual(ref)
  })

  it('rejects unknown ids and path traversal', async () => {
    await expect(app.assets.read('0'.repeat(64))).rejects.toBeInstanceOf(AssetNotFoundError)
    await expect(app.assets.read('../secret.key')).rejects.toBeInstanceOf(AssetNotFoundError)
    expect(app.assets.stat('../secret.key')).toBeUndefined()
  })
})

describe('secrets', () => {
  it('prefers env over stored keys and reports the source, not the key', () => {
    const withEnv = make({ ANTHROPIC_API_KEY: 'env-key' })
    withEnv.secrets.set('anthropic', 'stored-key')
    expect(withEnv.secrets.get('anthropic')).toBe('env-key')
    const status = withEnv.secrets.status().find((p) => p.id === 'anthropic')
    expect(status).toMatchObject({ configured: true, source: 'env' })
    expect(JSON.stringify(withEnv.secrets.status())).not.toContain('key')
    withEnv.db.close()
  })

  it('stores keys encrypted at rest', () => {
    app.secrets.set('openai', 'sk-super-secret')
    expect(app.secrets.get('openai')).toBe('sk-super-secret')
    expect(app.secrets.status().find((p) => p.id === 'openai')).toMatchObject({ source: 'stored' })

    const raw = app.db.prepare('SELECT value FROM settings WHERE key = ?').get('secret:openai') as {
      value: string
    }
    expect(raw.value).not.toContain('sk-super-secret')
    expect(readFileSync(join(dir, 'secret.key'), 'utf8')).not.toContain('sk-super-secret')

    app.secrets.delete('openai')
    expect(app.secrets.get('openai')).toBeUndefined()
    expect(app.secrets.status().find((p) => p.id === 'openai')?.configured).toBe(false)
  })

  it('rejects unknown providers', () => {
    expect(() => app.secrets.get('nope')).toThrow(/Unknown provider/)
    expect(() => app.secrets.set('nope', 'x')).toThrow(/Unknown provider/)
  })

  it('only accepts allow-listed settings', () => {
    app.settings.update({ ollamaBaseUrl: 'http://localhost:11434' })
    expect(app.settings.getAll()).toEqual({ ollamaBaseUrl: 'http://localhost:11434' })
    app.settings.update({ ollamaBaseUrl: null })
    expect(app.settings.getAll()).toEqual({})
    expect(() => app.settings.update({ 'secret:openai': 'x' } as never)).toThrow(/Unknown setting/)
  })
})

describe('runs', () => {
  it('runs a graph and persists the result', async () => {
    const { runId, done } = app.runs.start(greeting())
    const result = await done
    expect(result.status).toBe('done')

    const record = app.runs.get(runId)!
    expect(record.status).toBe('done')
    expect(record.finishedAt).not.toBeNull()
    expect(record.results.c).toMatchObject({ status: 'done', outputs: { text: 'Hello, world' } })
    expect(app.runs.list()[0]).toMatchObject({ id: runId, status: 'done' })
  })

  it('rejects bad requests synchronously', () => {
    const missingInput: GraphInput = { nodes: [{ id: 'c', type: 'core/concat' }], edges: [] }
    expect(() => app.runs.start(missingInput)).toThrow(GraphValidationError)
    expect(() => app.runs.start(greeting(), { targets: ['ghost'] })).toThrow(RunRequestError)
    expect(app.runs.list()).toEqual([])
  })

  it('supports run-selected via targets', async () => {
    const { runId, done } = app.runs.start(greeting(), { targets: ['a'] })
    await done
    expect(Object.keys(app.runs.get(runId)!.results)).toEqual(['a'])
  })

  it('reuses cached results across runs', async () => {
    const graph: GraphInput = { nodes: [{ id: 'n', type: 'test/counted' }], edges: [] }
    await app.runs.start(graph).done
    const second = app.runs.start(graph)
    await second.done
    expect(executions).toBe(1)
    expect(app.runs.get(second.runId)!.results.n?.cached).toBe(true)
  })

  it('cancels an active run', async () => {
    const graph: GraphInput = { nodes: [{ id: 'h', type: 'test/hang' }], edges: [] }
    const { runId, done } = app.runs.start(graph)
    expect(app.runs.cancel(runId)).toBe(true)
    expect((await done).status).toBe('cancelled')
    expect(app.runs.get(runId)).toMatchObject({
      status: 'cancelled',
      results: { h: { status: 'cancelled' } },
    })
    expect(app.runs.cancel(runId)).toBe(false) // already finished
    expect(app.runs.cancel('unknown')).toBe(false)
  })

  it('replays events to late subscribers and streams to live ones', async () => {
    const live: string[] = []
    const { runId, done } = app.runs.start(greeting())
    app.runs.subscribe(runId, (e) => live.push(e.type))
    await done

    const replay: ExecutionEvent[] = []
    app.runs.subscribe(runId, (e) => replay.push(e))
    expect(replay[0]?.type).toBe('run:start')
    expect(replay.at(-1)?.type).toBe('run:done')
    expect(live.at(-1)).toBe('run:done')
    expect(app.runs.subscribe('unknown', () => {})).toBeUndefined()
  })

  it('marks runs interrupted by a restart as cancelled', () => {
    const file = join(dir, 'restart.sqlite')
    const first = openDb(file)
    first
      .prepare("INSERT INTO runs (id, status, graph, started_at) VALUES ('r', 'running', '{}', ?)")
      .run(new Date().toISOString())
    first.close()

    const second = openDb(file)
    const row = second.prepare("SELECT status FROM runs WHERE id = 'r'").get() as { status: string }
    expect(row.status).toBe('cancelled')
    second.close()
  })
})

describe('websocket session', () => {
  const setup = () => {
    const messages: ServerMessage[] = []
    const session = createWsSession(app.runs, (m) => messages.push(m))
    const until = async (predicate: (m: ServerMessage) => boolean) => {
      for (let i = 0; i < 200 && !messages.some(predicate); i++) {
        await new Promise((r) => setTimeout(r, 5))
      }
      expect(messages.some(predicate)).toBe(true)
    }
    return { messages, session, until }
  }

  it('runs a graph and streams events', async () => {
    const { messages, session, until } = setup()
    session.onMessage(JSON.stringify({ type: 'run', graph: greeting(), requestId: 'req-1' }))
    await until((m) => m.type === 'event' && m.event.type === 'run:done')

    expect(messages[0]).toMatchObject({ type: 'accepted', requestId: 'req-1' })
    const types = messages.flatMap((m) => (m.type === 'event' ? [m.event.type] : []))
    expect(types[0]).toBe('run:start')
    expect(types.filter((t) => t === 'node:done')).toHaveLength(3)
  })

  it('cancels a run', async () => {
    const { messages, session, until } = setup()
    const graph = { nodes: [{ id: 'h', type: 'test/hang' }], edges: [] }
    session.onMessage(JSON.stringify({ type: 'run', graph }))
    const accepted = messages[0] as Extract<ServerMessage, { type: 'accepted' }>
    session.onMessage(JSON.stringify({ type: 'cancel', runId: accepted.runId }))
    await until((m) => m.type === 'event' && m.event.type === 'run:done')
    expect(messages).toContainEqual({ type: 'cancelling', runId: accepted.runId, ok: true })
    const done = messages.find((m) => m.type === 'event' && m.event.type === 'run:done')
    expect(done).toMatchObject({ event: { status: 'cancelled' } })
  })

  it('reports invalid messages and invalid graphs', () => {
    const { messages, session } = setup()
    session.onMessage('not json')
    session.onMessage(JSON.stringify({ type: 'explode' }))
    session.onMessage(
      JSON.stringify({
        type: 'run',
        requestId: 'r2',
        graph: { nodes: [{ id: 'c', type: 'core/concat' }], edges: [] },
      }),
    )
    session.onMessage(JSON.stringify({ type: 'run', graph: { nodes: 'nope' } }))

    expect(messages[0]).toMatchObject({ type: 'error', message: 'Invalid message' })
    expect(messages[1]).toMatchObject({ type: 'error', message: 'Invalid message' })
    expect(messages[2]).toMatchObject({ type: 'error', message: 'Invalid graph', requestId: 'r2' })
    expect((messages[2] as { issues: unknown[] }).issues).toHaveLength(2)
    expect(messages[3]).toMatchObject({ type: 'error', message: 'Malformed graph' })
  })

  it('stops streaming after close but the run still finishes', async () => {
    const { messages, session } = setup()
    session.onMessage(JSON.stringify({ type: 'run', graph: greeting() }))
    const count = messages.length
    session.close()
    const runId = (messages[0] as { runId: string }).runId
    await new Promise((r) => setTimeout(r, 50))
    expect(messages.length).toBe(count)
    expect(app.runs.get(runId)?.status).toBe('done')
  })
})
