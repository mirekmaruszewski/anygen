import { defineNode } from '@anygen/core'

export const textNode = defineNode({
  id: 'core/text',
  title: 'Text',
  category: 'Input',
  description: 'A constant piece of text.',
  outputs: [{ name: 'text', type: 'text' }],
  params: [{ name: 'value', type: 'textarea', label: 'Text', default: '' }],
  execute: (_ctx, _inputs, params) => ({ text: String(params.value ?? '') }),
})

export const concatNode = defineNode({
  id: 'core/concat',
  title: 'Concat',
  category: 'Utility',
  description: 'Joins two texts with a separator.',
  inputs: [
    { name: 'a', type: 'text' },
    { name: 'b', type: 'text' },
  ],
  outputs: [{ name: 'text', type: 'text' }],
  params: [{ name: 'separator', type: 'text', label: 'Separator', default: '\n' }],
  execute: (_ctx, inputs, params) => ({
    text: `${inputs.a}${params.separator ?? ''}${inputs.b}`,
  }),
})
