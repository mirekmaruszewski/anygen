import { defineNode } from '@anygen/core'
import { readAsset } from '../util/assets'

function loadNode(kind: 'image' | 'audio' | 'video', title: string) {
  return defineNode({
    id: `core/load-${kind}`,
    title,
    category: 'Input',
    description: `Picks a ${kind} file from your computer and outputs it as an asset.`,
    outputs: [{ name: kind, type: kind }],
    params: [{ name: 'file', type: 'asset', label: 'File', accept: `${kind}/*` }],
    execute: async (ctx, _inputs, params) => {
      const { ref } = await readAsset(ctx, params.file, kind)
      return { [kind]: ref }
    },
  })
}

export const loadImageNode = loadNode('image', 'Load Image')
export const loadAudioNode = loadNode('audio', 'Load Audio')
export const loadVideoNode = loadNode('video', 'Load Video')
