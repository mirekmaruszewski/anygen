import { defineNode } from '@anygen/core'

export const numberNode = defineNode({
  id: 'core/number',
  title: 'Number',
  category: 'Input',
  description: 'A constant number.',
  outputs: [{ name: 'number', type: 'number' }],
  params: [{ name: 'value', type: 'number', label: 'Value', default: 0 }],
  execute: (_ctx, _inputs, params) => ({ number: Number(params.value ?? 0) }),
})

export const seedNode = defineNode({
  id: 'core/seed',
  title: 'Seed',
  category: 'Input',
  description: 'A seed for generation nodes. "Random" picks a new seed on every run.',
  outputs: [{ name: 'seed', type: 'number' }],
  params: [
    { name: 'value', type: 'number', label: 'Seed', default: 0, min: 0, step: 1 },
    {
      name: 'mode',
      type: 'select',
      label: 'Mode',
      default: 'fixed',
      options: ['fixed', 'random'],
    },
  ],
  // Never cached: "random" must re-roll. Downstream nodes still cache on the seed value they get.
  cache: false,
  execute: (_ctx, _inputs, params) => ({
    seed:
      params.mode === 'random'
        ? Math.floor(Math.random() * 2 ** 31)
        : Math.max(0, Math.trunc(Number(params.value ?? 0))),
  }),
})
