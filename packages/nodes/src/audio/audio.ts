import { experimental_generateSpeech as generateSpeech, transcribe } from 'ai'
import { defineNode } from '@anygen/core'
import { getModels } from '../ai/models'
import { modelParam } from '../llm/chat'
import { extForMime, readAsset, saveAsset } from '../util/assets'

export const textToSpeechNode = defineNode({
  id: 'audio/tts',
  title: 'Text to Speech',
  category: 'Audio',
  description: 'Reads the text aloud.',
  inputs: [{ name: 'text', type: 'text' }],
  outputs: [{ name: 'audio', type: 'audio' }],
  params: [
    modelParam('openai:gpt-4o-mini-tts'),
    {
      name: 'voice',
      type: 'text',
      label: 'Voice',
      description: 'OpenAI voices: alloy, ash, coral, echo, fable, nova, onyx, sage, shimmer',
      default: 'alloy',
    },
    { name: 'speed', type: 'slider', label: 'Speed', default: 1, min: 0.5, max: 2, step: 0.05 },
  ],
  execute: async (ctx, inputs, params) => {
    ctx.progress({ message: 'Synthesizing speech…' })
    const { audio } = await generateSpeech({
      model: getModels(ctx).speech(String(params.model)),
      text: String(inputs.text),
      voice: String(params.voice || '') || undefined,
      speed: Number(params.speed ?? 1),
      abortSignal: ctx.signal,
    })
    return {
      audio: await saveAsset(ctx, audio.uint8Array, {
        name: `speech.${extForMime(audio.mediaType)}`,
        mime: audio.mediaType,
      }),
    }
  },
})

export const speechToTextNode = defineNode({
  id: 'audio/stt',
  title: 'Speech to Text',
  category: 'Audio',
  description: 'Transcribes an audio file.',
  inputs: [{ name: 'audio', type: 'audio' }],
  outputs: [{ name: 'text', type: 'text' }],
  params: [modelParam('openai:gpt-4o-transcribe')],
  execute: async (ctx, inputs, params) => {
    const { data } = await readAsset(ctx, inputs.audio, 'audio')
    ctx.progress({ message: 'Transcribing…' })
    const { text } = await transcribe({
      model: getModels(ctx).transcription(String(params.model)),
      audio: data,
      abortSignal: ctx.signal,
    })
    return { text }
  },
})
