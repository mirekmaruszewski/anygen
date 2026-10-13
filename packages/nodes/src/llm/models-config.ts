import { existsSync, readFileSync } from 'node:fs'
import { defineNode, type NodeDefinition } from '@anygen/core'
import { z } from 'zod'

const KINDS = ['language', 'image', 'speech', 'transcription', 'video'] as const
const PORT_TYPE = {
  language: 'model',
  image: 'image_model',
  speech: 'speech_model',
  transcription: 'transcription_model',
  video: 'video_model',
} as const

const ModelEntrySchema = z.object({
  /** `provider:model-name`, e.g. `anthropic:claude-sonnet-5-5` or `lmstudio:google/gemma-3-4b`. */
  id: z.string().regex(/^[^:\s]+:\S+$/, 'Must look like "provider:model-name"'),
  /** Shown on the node and in the palette. Defaults to the model name. */
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  /** What the model does; decides which nodes it can be connected to. Defaults to `language`. */
  kind: z.enum(KINDS).default('language'),
})
const ModelsFileSchema = z.object({ models: z.array(ModelEntrySchema) })

export type ModelEntry = z.input<typeof ModelEntrySchema>

/** Used when no models file exists, so a fresh checkout still has something to pick from. */
export const DEFAULT_MODELS: ModelEntry[] = [
  { id: 'anthropic:claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'openai:gpt-5', name: 'GPT-5' },
  { id: 'ollama:llama3.2', name: 'Llama 3.2 (Ollama)' },
  { id: 'lmstudio:google/gemma-3-4b', name: 'Gemma 3 4B (LM Studio)' },
  { id: 'openai:gpt-image-1', name: 'GPT Image 1', kind: 'image' },
  { id: 'fal:fal-ai/flux/dev', name: 'FLUX dev (fal)', kind: 'image' },
  { id: 'openai:gpt-4o-mini-tts', name: 'GPT-4o mini TTS', kind: 'speech' },
  { id: 'openai:gpt-4o-transcribe', name: 'GPT-4o Transcribe', kind: 'transcription' },
  { id: 'fal:luma-ray-2-flash', name: 'Luma Ray 2 Flash (fal)', kind: 'video' },
]

/** One palette item per model: no inputs, a single `model` output that LLM nodes accept. */
export function modelNodes(entries: readonly ModelEntry[]): NodeDefinition[] {
  return entries.map((entry) =>
    defineNode({
      id: `model/${entry.id}`,
      title: entry.name ?? entry.id.slice(entry.id.indexOf(':') + 1),
      category: 'Models',
      description: entry.description ?? entry.id,
      outputs: [{ name: 'model', type: PORT_TYPE[entry.kind ?? 'language'] }],
      execute: () => ({ model: entry.id }),
    }),
  )
}

/** Reads `{ "models": [...] }` from `file`; falls back to `DEFAULT_MODELS` when it is missing. */
export function loadModelNodes(file: string): NodeDefinition[] {
  if (!existsSync(file)) return modelNodes(DEFAULT_MODELS)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(
      `Cannot read models file ${file}: ${err instanceof Error ? err.message : err}`,
      {
        cause: err,
      },
    )
  }
  const parsed = ModelsFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    throw new Error(`Invalid models file ${file}: ${issue.path.join('.')} ${issue.message}`)
  }
  const ids = parsed.data.models.map((m) => m.id)
  const dup = ids.find((id, i) => ids.indexOf(id) !== i)
  if (dup) throw new Error(`Invalid models file ${file}: duplicate model "${dup}"`)
  return modelNodes(parsed.data.models)
}
