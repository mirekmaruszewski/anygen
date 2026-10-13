import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtinNodes } from '@anygen/nodes'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAnyGen } from '../../../app/server/lib/context'
import { runCli } from '../src/cli'
import { coerceParam, parseOverride } from '../src/overrides'

let dir: string
let stdout: string
let stderr: string

const io = { out: (t: string) => void (stdout += t), err: (t: string) => void (stderr += t) }
const cli = (args: string[]) =>
  runCli(args, {
    io,
    env: {},
    createAnyGen: (dataDir) =>
      createAnyGen({ dataDir, nodes: builtinNodes, dbFile: ':memory:', env: {} }),
  })

const writeGraph = (graph: unknown) => {
  const file = join(dir, 'wf.json')
  writeFileSync(file, JSON.stringify(graph))
  return file
}

const textGraph = {
  version: 1,
  nodes: [{ id: 'a', type: 'core/text', params: { value: 'hello' } }],
  edges: [],
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anygen-cli-'))
  stdout = stderr = ''
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('overrides', () => {
  it('parses node.param=value, splitting on the last dot before =', () => {
    expect(parseOverride('my.node.text=a=b')).toEqual({
      nodeId: 'my.node',
      param: 'text',
      value: 'a=b',
    })
    expect(() => parseOverride('nope')).toThrow(/Expected/)
  })

  it('coerces by param type', () => {
    expect(coerceParam({ name: 'n', type: 'number' }, '3')).toBe(3)
    expect(coerceParam({ name: 'b', type: 'boolean' }, 'false')).toBe(false)
    expect(coerceParam({ name: 'j', type: 'json' }, '{"a":1}')).toEqual({ a: 1 })
    expect(() => coerceParam({ name: 'n', type: 'number' }, 'x')).toThrow(/number/)
  })
})

describe('anygen run', () => {
  it('runs a workflow file and exits 0', async () => {
    expect(await cli(['run', writeGraph(textGraph)])).toBe(0)
    expect(stdout).toContain('a.text: hello')
  })

  it('applies --param overrides', async () => {
    const code = await cli(['run', writeGraph(textGraph), '--param', 'a.value=overridden'])
    expect(code).toBe(0)
    expect(stdout).toContain('a.text: overridden')
  })

  it('emits JSON lines with --json', async () => {
    await cli(['run', writeGraph(textGraph), '--json'])
    const events = stdout
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string })
    expect(events.map((e) => e.type)).toEqual(['run:start', 'node:start', 'node:done', 'run:done'])
  })

  it('writes asset outputs to --out', async () => {
    const graph = {
      version: 1,
      nodes: [
        { id: 'a', type: 'core/text', params: { value: 'payload' } },
        { id: 's', type: 'core/save-file', params: { filename: 'out.txt' } },
      ],
      edges: [{ from: { node: 'a', port: 'text' }, to: { node: 's', port: 'data' } }],
    }
    const outDir = join(dir, 'out')
    expect(await cli(['run', writeGraph(graph), '--out', outDir])).toBe(0)
    expect(readFileSync(join(outDir, 'out.txt'), 'utf8')).toContain('payload')
  })

  it('exits 1 for a bad override or unknown workflow', async () => {
    expect(await cli(['run', writeGraph(textGraph), '--param', 'zzz.value=1'])).toBe(1)
    expect(stderr).toContain('No node "zzz"')
    expect(await cli(['run', 'no-such-workflow'])).toBe(1)
  })
})

describe('anygen validate', () => {
  it('reports invalid graphs with exit 1', async () => {
    const bad = { version: 1, nodes: [{ id: 'a', type: 'nope/missing', params: {} }], edges: [] }
    expect(await cli(['validate', writeGraph(bad)])).toBe(1)
    expect(stderr).toContain('Invalid graph')
  })
})

describe('usage', () => {
  it('shows help and rejects unknown commands', async () => {
    expect(await cli(['--help'])).toBe(0)
    expect(stdout).toContain('Usage: anygen')
    expect(await cli(['frobnicate'])).toBe(2)
  })
})
