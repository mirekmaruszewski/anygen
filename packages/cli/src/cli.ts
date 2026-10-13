import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  GraphValidationError,
  assertValidGraph,
  isAssetRef,
  parseGraph,
  type ExecutionEvent,
  type Graph,
  type NodeResult,
  type RunStatus,
} from '@anygen/core'
import { builtinNodes } from '@anygen/nodes'
import { createAnyGen, type AnyGen } from '../../../app/server/lib/context'
import { applyOverrides, coerceParam, parseOverride } from './overrides'

export interface Io {
  out(text: string): void
  err(text: string): void
}

const USAGE = `Usage: anygen <command> [options]

Commands:
  run <file.json | workflowId>   Run a workflow
  list                           List saved workflows
  nodes                          List available node types
  validate <file.json>           Check a workflow file without running it

Run options:
  --target <nodeId>              Run only this node and its dependencies (repeatable)
  --param <node>.<name>=<value>  Override a node param (repeatable)
  --asset <node>.<name>=<path>   Upload a file into an asset param (repeatable)
  --out <dir>                    Write file outputs (Save JSON / Save File) to this directory
  --json                         Print events as JSON lines on stdout

Global options:
  --data-dir <path>              Data directory (default: $ANYGEN_DATA_DIR or ./data)
  -h, --help                     Show this help
`

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json',
  '.txt': 'text/plain',
}

const EXIT_BY_STATUS: Record<RunStatus, number> = { done: 0, error: 1, cancelled: 130 }

export interface CliOptions {
  io?: Io
  env?: Record<string, string | undefined>
  /** Replaces the default AnyGen setup; tests pass an in-memory one. */
  createAnyGen?: (dataDir: string) => AnyGen
}

/** Runs the CLI and returns the process exit code. */
export async function runCli(argv: string[], options: CliOptions = {}): Promise<number> {
  const io: Io = options.io ?? {
    out: (t) => process.stdout.write(t),
    err: (t) => process.stderr.write(t),
  }
  const env = options.env ?? process.env

  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        target: { type: 'string', multiple: true },
        param: { type: 'string', multiple: true },
        asset: { type: 'string', multiple: true },
        out: { type: 'string' },
        json: { type: 'boolean' },
        'data-dir': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (err) {
    io.err(`${(err as Error).message}\n\n${USAGE}`)
    return 2
  }

  const [command, arg] = parsed.positionals
  if (parsed.values.help || !command) {
    io.out(USAGE)
    return command || parsed.values.help ? 0 : 2
  }

  const dataDir = resolve(parsed.values['data-dir'] ?? env.ANYGEN_DATA_DIR ?? 'data')
  const anygen = (options.createAnyGen ?? defaultCreate(env))(dataDir)
  try {
    switch (command) {
      case 'list':
        return list(anygen, io)
      case 'nodes':
        return nodes(anygen, io)
      case 'validate':
        return await validate(anygen, arg, io)
      case 'run':
        return await run(anygen, arg, parsed.values, io)
      default:
        io.err(`Unknown command "${command}"\n\n${USAGE}`)
        return 2
    }
  } catch (err) {
    const message =
      err instanceof GraphValidationError ? err.message : `Error: ${(err as Error).message}`
    io.err(`${message}\n`)
    return 1
  } finally {
    anygen.db.close()
  }
}

const defaultCreate = (env: Record<string, string | undefined>) => (dataDir: string) =>
  createAnyGen({ dataDir, nodes: builtinNodes, env })

function list(anygen: AnyGen, io: Io): number {
  const workflows = anygen.workflows.list()
  if (workflows.length === 0) io.out('No saved workflows.\n')
  for (const w of workflows) io.out(`${w.id}  ${w.name}  (updated ${w.updatedAt})\n`)
  return 0
}

function nodes(anygen: AnyGen, io: Io): number {
  for (const n of anygen.registry.list()) io.out(`${n.id}  ${n.title}\n`)
  return 0
}

/** A path to a graph JSON file, or the id of a saved workflow. */
async function loadGraph(
  anygen: AnyGen,
  arg: string | undefined,
): Promise<{ graph: Graph; workflowId?: string }> {
  if (!arg) throw new Error('Missing workflow: pass a .json file or a saved workflow id')
  let text: string | undefined
  try {
    text = await readFile(arg, 'utf8')
  } catch {
    // not a readable file: fall through to the saved-workflow lookup
  }
  if (text !== undefined) {
    try {
      return { graph: parseGraph(JSON.parse(text)) }
    } catch (err) {
      throw new Error(`${arg} is not a valid workflow: ${(err as Error).message}`, { cause: err })
    }
  }
  const workflow = anygen.workflows.get(arg)
  if (!workflow) throw new Error(`"${arg}" is neither a readable file nor a saved workflow id`)
  return { graph: workflow.graph, workflowId: workflow.id }
}

async function validate(anygen: AnyGen, arg: string | undefined, io: Io): Promise<number> {
  const { graph } = await loadGraph(anygen, arg)
  assertValidGraph(graph, anygen.registry)
  io.out(`OK: ${graph.nodes.length} nodes, ${graph.edges.length} edges\n`)
  return 0
}

interface RunValues {
  target?: string[]
  param?: string[]
  asset?: string[]
  out?: string
  json?: boolean
}

async function run(anygen: AnyGen, arg: string | undefined, values: RunValues, io: Io) {
  const loaded = await loadGraph(anygen, arg)
  let graph = await applyOverrides(
    loaded.graph,
    anygen.registry,
    (values.param ?? []).map(parseOverride),
    coerceParam,
  )
  graph = await applyOverrides(
    graph,
    anygen.registry,
    (values.asset ?? []).map(parseOverride),
    async (def, path) => {
      if (def.type !== 'asset') throw new Error(`"${def.name}" is not a file param; use --param`)
      const data = new Uint8Array(await readFile(path))
      const mime = MIME_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream'
      return anygen.assets.save(data, { name: basename(path), mime })
    },
  )

  const { runId, done } = anygen.runs.start(graph, {
    workflowId: loaded.workflowId,
    targets: values.target,
  })
  anygen.runs.subscribe(runId, values.json ? jsonPrinter(io) : humanPrinter(io))

  const onSigint = () => {
    io.err('\nCancelling…\n')
    anygen.runs.cancel(runId)
  }
  process.once('SIGINT', onSigint)
  const result = await done.finally(() => process.off('SIGINT', onSigint))

  if (values.out) await exportFiles(anygen, result.results, values.out, io)
  return EXIT_BY_STATUS[result.status]
}

const jsonPrinter = (io: Io) => (event: ExecutionEvent) => {
  if (event.type !== 'node:progress') io.out(`${JSON.stringify(event)}\n`)
}

function humanPrinter(io: Io) {
  return (event: ExecutionEvent) => {
    switch (event.type) {
      case 'run:start':
        io.err(`Run ${event.runId}: ${event.nodeIds.length} nodes\n`)
        break
      case 'node:start':
        io.err(`  ▶ ${event.nodeId}\n`)
        break
      case 'node:done':
        io.err(`  ✔ ${event.nodeId}${event.cached ? ' (cached)' : ''}\n`)
        for (const [port, value] of Object.entries(event.outputs)) {
          io.out(`${event.nodeId}.${port}: ${describe(value)}\n`)
        }
        break
      case 'node:error':
        io.err(`  ✘ ${event.nodeId}: ${event.error}\n`)
        break
      case 'node:skipped':
        io.err(`  – ${event.nodeId} skipped (${event.blockedBy} failed)\n`)
        break
      case 'node:cancelled':
        io.err(`  – ${event.nodeId} cancelled\n`)
        break
      case 'run:done':
        io.err(`Run ${event.status}\n`)
        break
    }
  }
}

function describe(value: unknown): string {
  if (isAssetRef(value)) return `[${value.mime} ${value.name}, ${value.size} bytes]`
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value))
  return text.length > 200 ? `${text.slice(0, 200)}… (${text.length} chars)` : text
}

/** Writes every asset-ref output of finished nodes to `dir`, named after the asset. */
async function exportFiles(
  anygen: AnyGen,
  results: Record<string, NodeResult>,
  dir: string,
  io: Io,
) {
  const seen = new Set<string>()
  for (const result of Object.values(results)) {
    for (const value of Object.values(result.outputs ?? {})) {
      if (!isAssetRef(value) || seen.has(value.assetId)) continue
      seen.add(value.assetId)
      const { ref, data } = await anygen.assets.read(value.assetId)
      await mkdir(dir, { recursive: true })
      const target = join(dir, basename(ref.name))
      await writeFile(target, data)
      io.err(`Wrote ${target}\n`)
    }
  }
}
