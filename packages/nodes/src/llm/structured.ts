import { defineNode, type ParamDef } from '@anygen/core'
import { runStructured } from '../ai/text'
import { imagePart, readAsset } from '../util/assets'
import { modelParam } from './chat'

const DEFAULT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    keyPoints: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'summary', 'keyPoints'],
  additionalProperties: false,
}

const schemaParam: ParamDef = {
  name: 'schema',
  type: 'json',
  label: 'JSON Schema',
  description: 'The output must match this JSON Schema (the root must be an object).',
  default: DEFAULT_SCHEMA,
}

const systemParam: ParamDef = {
  name: 'system',
  type: 'textarea',
  label: 'System prompt',
  default: '',
}

/** Params arrive from the editor as parsed JSON, or as a raw string when the JSON was invalid. */
export function parseSchemaParam(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    throw new Error('The JSON Schema param is not valid JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The JSON Schema param must be a JSON object')
  }
  return value as Record<string, unknown>
}

export const structuredOutputNode = defineNode({
  id: 'llm/structured',
  title: 'Structured Output',
  category: 'LLM',
  description: 'Generates JSON that is validated against a JSON Schema (one retry on mismatch).',
  inputs: [{ name: 'prompt', type: 'text' }],
  outputs: [{ name: 'json', type: 'json' }],
  params: [modelParam('anthropic:claude-sonnet-5-5'), schemaParam, systemParam],
  execute: async (ctx, inputs, params) => ({
    json: await runStructured({
      ctx,
      model: String(params.model),
      system: String(params.system ?? ''),
      messages: [{ role: 'user', content: String(inputs.prompt) }],
      schema: parseSchemaParam(params.schema),
    }),
  }),
})

export const visionStructuredNode = defineNode({
  id: 'llm/vision-structured',
  title: 'Vision Structured Output',
  category: 'LLM',
  description:
    'Reads an image with a vision model and returns JSON validated against a JSON Schema (one retry on mismatch).',
  inputs: [
    { name: 'image', type: 'image' },
    {
      name: 'prompt',
      type: 'text',
      required: false,
      default: 'Extract the information from this image.',
    },
  ],
  outputs: [{ name: 'json', type: 'json' }],
  params: [modelParam('anthropic:claude-sonnet-5-5'), schemaParam, systemParam],
  execute: async (ctx, inputs, params) => {
    const { ref, data } = await readAsset(ctx, inputs.image, 'image')
    return {
      json: await runStructured({
        ctx,
        model: String(params.model),
        system: String(params.system ?? ''),
        messages: [
          {
            role: 'user',
            content: [imagePart(data, ref.mime), { type: 'text', text: String(inputs.prompt) }],
          },
        ],
        schema: parseSchemaParam(params.schema),
      }),
    }
  },
})
