import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NodeRegistry, parseGraph, validateGraph } from '@anygen/core'
import { builtinNodes, loadModelNodes } from '../src'

const dir = join(__dirname, '..', '..', '..', 'workflows')

describe('example workflows', () => {
  const registry = new NodeRegistry().registerAll([
    ...builtinNodes,
    ...loadModelNodes(join(__dirname, '..', '..', '..', 'models.json')),
  ])
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))

  it('exist', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s is a valid graph for the built-in nodes', (file) => {
    const graph = parseGraph(JSON.parse(readFileSync(join(dir, file), 'utf8')))
    expect(validateGraph(graph, registry)).toEqual([])
  })
})
