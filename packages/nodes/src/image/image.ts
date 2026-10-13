import { generateImage } from 'ai'
import { defineNode, type ParamDef } from '@anygen/core'
import { getModels } from '../ai/models'
import { modelInput } from '../llm/chat'
import { readAsset, saveAsset, extForMime } from '../util/assets'

const ASPECT_RATIOS = ['', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']

const aspectParam: ParamDef = {
  name: 'aspectRatio',
  type: 'select',
  label: 'Aspect ratio',
  description: 'Used by Flux-style models. Leave on "model default" for others.',
  default: '',
  options: ASPECT_RATIOS.map((value) => ({ value, label: value || 'model default' })),
}

const sizeParam: ParamDef = {
  name: 'size',
  type: 'text',
  label: 'Size (WIDTHxHEIGHT)',
  description: 'Used by OpenAI models, e.g. 1024x1024. Leave empty for the model default.',
  default: '',
}

const seedInput = { name: 'seed', type: 'number', required: false } as const

type Size = `${number}x${number}`
const asSize = (v: unknown): Size | undefined => {
  const s = String(v ?? '').trim()
  if (!s) return undefined
  if (!/^\d+x\d+$/.test(s)) throw new Error(`Size "${s}" must look like 1024x1024`)
  return s as Size
}
const asAspect = (v: unknown) => (String(v ?? '') || undefined) as `${number}:${number}` | undefined

export const imageGenerateNode = defineNode({
  id: 'image/generate',
  title: 'Generate Image',
  category: 'Image',
  description:
    'Generates an image from a prompt with the connected image model (OpenAI, fal or Replicate).',
  inputs: [modelInput('image_model'), { name: 'prompt', type: 'text' }, seedInput],
  outputs: [{ name: 'image', type: 'image' }],
  params: [sizeParam, aspectParam],
  execute: async (ctx, inputs, params) => {
    ctx.progress({ message: 'Generating image…' })
    const { image } = await generateImage({
      model: getModels(ctx).image(String(inputs.model)),
      prompt: String(inputs.prompt),
      n: 1,
      size: asSize(params.size),
      aspectRatio: asAspect(params.aspectRatio),
      seed: typeof inputs.seed === 'number' ? inputs.seed : undefined,
      abortSignal: ctx.signal,
    })
    return {
      image: await saveAsset(ctx, image.uint8Array, {
        name: `image.${extForMime(image.mediaType)}`,
        mime: image.mediaType,
      }),
    }
  },
})

export const imageToImageNode = defineNode({
  id: 'image/edit',
  title: 'Image to Image',
  category: 'Image',
  description: 'Edits or restyles an image following a prompt (model must support image input).',
  inputs: [
    modelInput('image_model'),
    { name: 'image', type: 'image' },
    { name: 'prompt', type: 'text' },
    seedInput,
  ],
  outputs: [{ name: 'image', type: 'image' }],
  params: [sizeParam, aspectParam],
  execute: async (ctx, inputs, params) => {
    const source = await readAsset(ctx, inputs.image, 'image')
    ctx.progress({ message: 'Editing image…' })
    const { image } = await generateImage({
      model: getModels(ctx).image(String(inputs.model)),
      prompt: { images: [source.data], text: String(inputs.prompt) },
      n: 1,
      size: asSize(params.size),
      aspectRatio: asAspect(params.aspectRatio),
      seed: typeof inputs.seed === 'number' ? inputs.seed : undefined,
      abortSignal: ctx.signal,
    })
    return {
      image: await saveAsset(ctx, image.uint8Array, {
        name: `image.${extForMime(image.mediaType)}`,
        mime: image.mediaType,
      }),
    }
  },
})
