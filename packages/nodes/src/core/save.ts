import { defineNode, isAssetRef } from '@anygen/core'
import { extForMime, safeFileName, saveAsset } from '../util/assets'

const encoder = new TextEncoder()

export const saveJsonNode = defineNode({
  id: 'core/save-json',
  title: 'Save JSON',
  category: 'Output',
  description: 'Stores the JSON as a file in the asset store. Select the node to download it.',
  inputs: [{ name: 'json', type: 'json' }],
  outputs: [{ name: 'file', type: 'any' }],
  params: [
    { name: 'filename', type: 'text', label: 'File name', default: 'output.json' },
    { name: 'pretty', type: 'boolean', label: 'Pretty print', default: true },
  ],
  execute: async (ctx, inputs, params) => {
    const text = JSON.stringify(inputs.json, null, params.pretty === false ? undefined : 2)
    const file = await saveAsset(ctx, encoder.encode(text), {
      name: safeFileName(params.filename, 'output.json', 'json'),
      mime: 'application/json',
    })
    return { file }
  },
})

export const saveFileNode = defineNode({
  id: 'core/save-file',
  title: 'Save File',
  category: 'Output',
  description:
    'Stores text, JSON or any asset (image, audio, video) under a file name. Select the node to download it.',
  inputs: [{ name: 'data', type: 'any' }],
  outputs: [{ name: 'file', type: 'any' }],
  params: [{ name: 'filename', type: 'text', label: 'File name', default: 'output' }],
  execute: async (ctx, inputs, params) => {
    const { data } = inputs
    if (isAssetRef(data)) {
      // Content-addressed storage: the bytes are already saved, only the display name changes.
      const name = safeFileName(params.filename, data.name, extForMime(data.mime))
      return { file: { ...data, name } }
    }
    const isText = typeof data === 'string'
    const body = isText ? data : JSON.stringify(data, null, 2)
    const file = await saveAsset(ctx, encoder.encode(body ?? ''), {
      name: safeFileName(params.filename, 'output', isText ? 'txt' : 'json'),
      mime: isText ? 'text/plain' : 'application/json',
    })
    return { file }
  },
})
