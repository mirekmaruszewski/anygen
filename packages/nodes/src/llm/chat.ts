import { defineNode, type ParamDef } from '@anygen/core'
import { runText } from '../ai/text'
import { imagePart, readAsset } from '../util/assets'

export const modelParam = (def: string, description?: string): ParamDef => ({
  name: 'model',
  type: 'text',
  label: 'Model',
  default: def,
  description: description ?? 'Format: provider:model-name',
})

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

function chatNode(opts: { id: string; title: string; model: string; description: string }) {
  return defineNode({
    id: opts.id,
    title: opts.title,
    category: 'LLM',
    description: opts.description,
    inputs: [
      { name: 'prompt', type: 'text' },
      { name: 'system', type: 'text', label: 'System prompt', required: false },
    ],
    outputs: [{ name: 'text', type: 'text' }],
    params: [modelParam(opts.model), temperatureParam, maxTokensParam],
    execute: async (ctx, inputs, params) => ({
      text: await runText({
        ctx,
        model: String(params.model),
        system: inputs.system as string | undefined,
        messages: [{ role: 'user', content: String(inputs.prompt) }],
        temperature: Number(params.temperature ?? 0.7),
        maxOutputTokens: positive(params.maxTokens),
      }),
    }),
  })
}

export const claudeChatNode = chatNode({
  id: 'anthropic/chat',
  title: 'Claude Chat',
  model: 'anthropic:claude-sonnet-5-5',
  description: 'Chat with a Claude model. Output streams into the inspector as it is written.',
})

export const openaiChatNode = chatNode({
  id: 'openai/chat',
  title: 'OpenAI Chat',
  model: 'openai:gpt-5',
  description: 'Chat with an OpenAI model.',
})

export const ollamaChatNode = chatNode({
  id: 'ollama/chat',
  title: 'Ollama Chat',
  model: 'ollama:llama3.2',
  description: 'Chat with a local Ollama model. Set the server URL in Settings if it is not local.',
})

export const visionNode = defineNode({
  id: 'llm/vision',
  title: 'Vision',
  category: 'LLM',
  description: 'Asks a vision-capable model about an image.',
  inputs: [
    { name: 'image', type: 'image' },
    { name: 'prompt', type: 'text' },
    { name: 'system', type: 'text', label: 'System prompt', required: false },
  ],
  outputs: [{ name: 'text', type: 'text' }],
  params: [modelParam('anthropic:claude-sonnet-5-5'), temperatureParam, maxTokensParam],
  execute: async (ctx, inputs, params) => {
    const { ref, data } = await readAsset(ctx, inputs.image, 'image')
    return {
      text: await runText({
        ctx,
        model: String(params.model),
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
