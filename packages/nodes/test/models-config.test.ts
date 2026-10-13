import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MODELS, loadModelNodes } from '../src'
import { run, testContext } from './helpers'

const fileWith = (content: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'models-')), 'models.json')
  writeFileSync(file, content)
  return file
}

describe('models.json', () => {
  it('creates one model node per entry', async () => {
    const nodes = loadModelNodes(
      fileWith(
        '{"models":[{"id":"lmstudio:google/gemma-3-4b","name":"Gemma"},{"id":"openai:gpt-5"},{"id":"openai:gpt-image-1","kind":"image"}]}',
      ),
    )
    expect(nodes.map((n) => [n.id, n.title, n.category])).toEqual([
      ['model/lmstudio:google/gemma-3-4b', 'Gemma', 'Models'],
      ['model/openai:gpt-5', 'gpt-5', 'Models'],
      ['model/openai:gpt-image-1', 'gpt-image-1', 'Models'],
    ])
    expect(nodes[2]!.outputs).toMatchObject([{ type: 'image_model' }])
    expect(nodes[0]!.outputs).toMatchObject([{ name: 'model', type: 'model' }])
    expect((await run(nodes[0]!, testContext({}))).model).toBe('lmstudio:google/gemma-3-4b')
  })

  it('falls back to the defaults when the file is missing', () => {
    expect(loadModelNodes(join(tmpdir(), 'nope', 'models.json'))).toHaveLength(
      DEFAULT_MODELS.length,
    )
  })

  it('reports bad files clearly', () => {
    expect(() => loadModelNodes(fileWith('{oops'))).toThrow(/Cannot read models file/)
    expect(() => loadModelNodes(fileWith('{"models":[{"id":"nocolon"}]}'))).toThrow(/models\.0\.id/)
    expect(() => loadModelNodes(fileWith('{"models":[{"id":"a:b"},{"id":"a:b"}]}'))).toThrow(
      /duplicate/,
    )
  })
})
