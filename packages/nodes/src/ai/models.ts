import { createAnthropic } from '@ai-sdk/anthropic'
import { createFal } from '@ai-sdk/fal'
import { createOpenAI } from '@ai-sdk/openai'
import { createReplicate } from '@ai-sdk/replicate'
import { createProviderRegistry } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOllama } from 'ollama-ai-provider-v2'
import { getServices, type AnyGenServices, type ExecutionContext } from '@anygen/core'

type Registry = ReturnType<typeof createProviderRegistry>

export interface ModelResolver {
  language(id: string): ReturnType<Registry['languageModel']>
  image(id: string): ReturnType<Registry['imageModel']>
  speech(id: string): ReturnType<Registry['speechModel']>
  transcription(id: string): ReturnType<Registry['transcriptionModel']>
  video(id: string): ReturnType<Registry['videoModel']>
}

/** Env var / settings name that configures each key-based provider (mirrors the server docs). */
const KEY_HINT: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  replicate: 'REPLICATE_API_TOKEN',
  fal: 'FAL_KEY',
}

/** Ollama's API lives under `/api`; accept the bare host URL users usually copy. */
export function ollamaBaseUrl(configured: string | undefined): string {
  const base = (configured?.trim() || 'http://127.0.0.1:11434').replace(/\/+$/, '')
  return base.endsWith('/api') ? base : `${base}/api`
}

/** LM Studio (and other OpenAI-compatible servers) serve under `/v1`; accept the bare host URL. */
export function lmstudioBaseUrl(configured: string | undefined): string {
  const base = (configured?.trim() || 'http://localhost:1234').replace(/\/+$/, '')
  return base.endsWith('/v1') ? base : `${base}/v1`
}

/**
 * Builds the provider registry from whatever keys are configured right now, so keys saved in the
 * settings page take effect without a restart. Model ids look like `anthropic:claude-sonnet-5-5`.
 */
export function createModelResolver(services: AnyGenServices): ModelResolver {
  const providers: Record<string, never> = {}
  const add = (name: string, provider: unknown) => {
    providers[name] = provider as never
  }
  const key = (name: string) => services.secrets.get(name)

  const anthropic = key('anthropic')
  if (anthropic) add('anthropic', createAnthropic({ apiKey: anthropic }))
  const openai = key('openai')
  if (openai) add('openai', createOpenAI({ apiKey: openai }))
  const replicate = key('replicate')
  if (replicate) add('replicate', createReplicate({ apiToken: replicate }))
  const fal = key('fal')
  if (fal) add('fal', createFal({ apiKey: fal }))
  add('ollama', createOllama({ baseURL: ollamaBaseUrl(services.settings?.get('ollamaBaseUrl')) }))

  add(
    'lmstudio',
    createOpenAICompatible({
      name: 'lmstudio',
      baseURL: lmstudioBaseUrl(services.settings?.get('lmstudioBaseUrl')),
      supportsStructuredOutputs: true,
    }),
  )

  const registry = createProviderRegistry(providers)

  /** Validates `provider:model` and turns a missing key into an actionable message. */
  const check = (id: string): string => {
    const sep = id.indexOf(':')
    if (sep <= 0 || sep === id.length - 1) {
      throw new Error(
        `Model "${id}" must look like "provider:model-name" (e.g. anthropic:claude-sonnet-5-5)`,
      )
    }
    const provider = id.slice(0, sep)
    if (!(provider in providers)) {
      const hint = KEY_HINT[provider]
      throw new Error(
        hint
          ? `Provider "${provider}" is not configured. Set ${hint} or add the key in Settings.`
          : `Unknown provider "${provider}". Known: ${[...Object.keys(KEY_HINT), 'ollama', 'lmstudio'].join(', ')}`,
      )
    }
    return id
  }

  // The registry's literal-typed overloads don't fit user-supplied strings.
  const r = registry as unknown as Record<string, (id: string) => never>
  return {
    language: (id) => r.languageModel!(check(id)),
    image: (id) => r.imageModel!(check(id)),
    speech: (id) => r.speechModel!(check(id)),
    transcription: (id) => r.transcriptionModel!(check(id)),
    video: (id) => r.videoModel!(check(id)),
  }
}

/** Nodes call this; hosts and tests may inject `services.modelResolver` instead. */
export function getModels(ctx: Pick<ExecutionContext, 'services'>): ModelResolver {
  const injected = (ctx.services as { modelResolver?: ModelResolver }).modelResolver
  return injected ?? createModelResolver(getServices(ctx))
}
