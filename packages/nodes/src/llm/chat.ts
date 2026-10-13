import { defineNode, type ParamDef, type PortType } from '@anygen/core'
import { runText } from '../ai/text'
import { imagePart, readAsset } from '../util/assets'

/** The `model` input every model-using node has; the model comes from a model node. */
export const modelInput = (type: PortType = 'model') => ({ name: 'model', type }) as const

const temperatureParam: ParamDef = {
  name: 'temperature',
  type: 'slider',
  label: 'Temperature',
  default: 0.7,
  min: 0,
  max: 1,
  step: 0.05,
}

const maxTokensParam: ParamDef = {
  name: 'maxTokens',
  type: 'number',
  label: 'Max output tokens (0 = default)',
  default: 0,
  min: 0,
  step: 1,
}

const positive = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined)

export const chatNode = defineNode({
  id: 'llm/chat',
  title: 'Chat',
  category: 'LLM',
  description:
    'Chat with the model connected to its model input. Output streams into the inspector as it is written.',
  inputs: [
    modelInput(),
    { name: 'prompt', type: 'text' },
    { name: 'system', type: 'text', label: 'System prompt', required: false },
  ],
  outputs: [{ name: 'text', type: 'text' }],
  params: [temperatureParam, maxTokensParam],
  execute: async (ctx, inputs, params) => ({
    text: await runText({
      ctx,
      model: String(inputs.model),
      system: inputs.system as string | undefined,
      messages: [{ role: 'user', content: String(inputs.prompt) }],
      temperature: Number(params.temperature ?? 0.7),
      maxOutputTokens: positive(params.maxTokens),
    }),
  }),
})

export const visionNode = defineNode({
  id: 'llm/vision',
  title: 'Vision',
  category: 'LLM',
  description: 'Asks a vision-capable model about an image.',
  inputs: [
    modelInput(),
    { name: 'image', type: 'image' },
    { name: 'prompt', type: 'text' },
    { name: 'system', type: 'text', label: 'System prompt', required: false },
  ],
  outputs: [{ name: 'text', type: 'text' }],
  params: [temperatureParam, maxTokensParam],
  execute: async (ctx, inputs, params) => {
    const { ref, data } = await readAsset(ctx, inputs.image, 'image')
    return {
      text: await runText({
        ctx,
        model: String(inputs.model),
        system: inputs.system as string | undefined,
        messages: [
          {
            role: 'user',
            content: [imagePart(data, ref.mime), { type: 'text', text: String(inputs.prompt) }],
          },
        ],
        temperature: Number(params.temperature ?? 0.7),
        maxOutputTokens: positive(params.maxTokens),
      }),
    }
  },
})
