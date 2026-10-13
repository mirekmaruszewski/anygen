import { defineNode } from '@anygen/core'

export const switchNode = defineNode({
  id: 'core/switch',
  title: 'Switch',
  category: 'Utility',
  description:
    'Passes "if true" or "if false" on, depending on the condition. Both branches are still computed.',
  inputs: [
    { name: 'condition', type: 'boolean', required: false, default: false },
    { name: 'ifTrue', type: 'any', label: 'If true' },
    { name: 'ifFalse', type: 'any', label: 'If false' },
  ],
  outputs: [{ name: 'value', type: 'any' }],
  execute: (_ctx, inputs) => ({ value: inputs.condition ? inputs.ifTrue : inputs.ifFalse }),
})

export const previewNode = defineNode({
  id: 'core/preview',
  title: 'Preview',
  category: 'Output',
  description:
    'Shows whatever flows through it in the inspector. The value is passed on unchanged.',
  inputs: [{ name: 'value', type: 'any' }],
  outputs: [{ name: 'value', type: 'any' }],
  execute: (_ctx, inputs) => ({ value: inputs.value }),
})
