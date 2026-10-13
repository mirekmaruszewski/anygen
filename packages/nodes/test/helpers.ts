import { createHash } from 'node:crypto'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import type {
  AssetRef,
  AssetStore,
  ExecutionContext,
  NodeDefinition,
  NodeProgress,
  PortValues,
} from '@anygen/core'
import type { ModelResolver } from '../src'

export function memoryAssets(): AssetStore & {
  files: Map<string, { ref: AssetRef; data: Uint8Array }>
} {
  const files = new Map<string, { ref: AssetRef; data: Uint8Array }>()
  return {
    files,
    async save(data, meta) {
      const assetId = createHash('sha256').update(data).digest('hex')
      const ref: AssetRef = { assetId, mime: meta.mime, name: meta.name, size: data.byteLength }
      files.set(assetId, { ref, data })
      return ref
    },
    async read(assetId) {
      const found = files.get(assetId)
      if (!found) throw new Error(`Asset not found: ${assetId}`)
      return found
    },
  }
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

/** A model that answers with each of `answers` in turn (the last one repeats) and records prompts. */
export function mockLanguageModel(answers: string[]) {
  const prompts: unknown[] = []
  let call = 0
  const next = () => answers[Math.min(call++, answers.length - 1)]!
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(options.prompt)
      return {
        content: [{ type: 'text', text: next() }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      }
    },
    doStream: async (options) => {
      prompts.push(options.prompt)
      const text = next()
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 't' },
            ...text.split(' ').map((w, i) => ({
              type: 'text-delta' as const,
              id: 't',
              delta: i ? ` ${w}` : w,
            })),
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ],
        }),
      }
    },
  })
  return { model, prompts, calls: () => call }
}

export interface TestCtx {
  ctx: ExecutionContext
  progress: NodeProgress[]
  assets: ReturnType<typeof memoryAssets>
  abort(): void
}

export function testContext(
  opts: { model?: unknown; secrets?: Record<string, string> } = {},
): TestCtx {
  const assets = memoryAssets()
  const progress: NodeProgress[] = []
  const controller = new AbortController()
  const resolver = opts.model
    ? ({
        language: () => opts.model,
        image: () => opts.model,
        speech: () => opts.model,
        transcription: () => opts.model,
        video: () => opts.model,
      } as unknown as ModelResolver)
    : undefined
  return {
    assets,
    progress,
    abort: () => controller.abort(),
    ctx: {
      runId: 'run',
      nodeId: 'node',
      signal: controller.signal,
      progress: (p) => progress.push(p),
      services: {
        assets,
        secrets: { get: (provider: string) => opts.secrets?.[provider] },
        modelResolver: resolver,
      },
    },
  }
}

export const run = (
  node: NodeDefinition,
  t: TestCtx,
  inputs: PortValues = {},
  params: PortValues = {},
) => {
  // Mirror the executor: fill in param defaults.
  const full: PortValues = {}
  for (const p of node.params) full[p.name] = params[p.name] ?? p.default
  return Promise.resolve(node.execute(t.ctx, inputs, full))
}

/** A 1x1 PNG. */
export const PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)
