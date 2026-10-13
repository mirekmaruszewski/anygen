import { experimental_generateVideo as generateVideo } from 'ai'
import { defineNode } from '@anygen/core'
import { getModels } from '../ai/models'
import { modelInput } from '../llm/chat'
import { extForMime, readAsset, saveAsset } from '../util/assets'

/**
 * Text/image to video through the AI SDK's (experimental) video API. fal and Replicate run these
 * as async jobs; the SDK polls until the result is ready, so a run can take minutes. Cancelling the
 * run aborts the wait.
 */
export const videoGenerateNode = defineNode({
  id: 'video/generate',
  title: 'Video (Text/Image to Video)',
  category: 'Video',
  description:
    'Generates a video from a prompt, optionally animating an input image. Runs as an async job and can take minutes.',
  inputs: [
    modelInput('video_model'),
    { name: 'prompt', type: 'text' },
    { name: 'image', type: 'image', required: false },
    { name: 'seed', type: 'number', required: false },
  ],
  outputs: [{ name: 'video', type: 'video' }],
  params: [
    {
      name: 'aspectRatio',
      type: 'select',
      label: 'Aspect ratio',
      default: '',
      options: [
        { value: '', label: 'model default' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' },
      ],
    },
    {
      name: 'duration',
      type: 'number',
      label: 'Duration in seconds (0 = model default)',
      default: 0,
      min: 0,
      step: 1,
    },
  ],
  execute: async (ctx, inputs, params) => {
    const text = String(inputs.prompt)
    const image = inputs.image ? (await readAsset(ctx, inputs.image, 'image')).data : undefined
    const duration = Number(params.duration ?? 0)
    ctx.progress({ message: 'Waiting for the video job (this can take minutes)…' })

    const { video } = await generateVideo({
      model: getModels(ctx).video(String(inputs.model)),
      prompt: image ? { image, text } : text,
      aspectRatio: (String(params.aspectRatio ?? '') || undefined) as
        `${number}:${number}` | undefined,
      duration: duration > 0 ? duration : undefined,
      seed: typeof inputs.seed === 'number' ? inputs.seed : undefined,
      abortSignal: ctx.signal,
    })
    return {
      video: await saveAsset(ctx, video.uint8Array, {
        name: `video.${extForMime(video.mediaType)}`,
        mime: video.mediaType,
      }),
    }
  },
})
