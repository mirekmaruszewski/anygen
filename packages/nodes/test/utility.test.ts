import { describe, expect, it } from 'vitest'
import { NodeRegistry, toCatalogEntry } from '@anygen/core'
import { builtinNodes, htmlToText, renderTemplate } from '../src'
import { loadImageNode } from '../src/core/load-media'
import { saveFileNode, saveJsonNode } from '../src/core/save'
import { seedNode } from '../src/core/number'
import { switchNode } from '../src/core/flow'
import { htmlToTextNode } from '../src/core/html-to-text'
import { templateNode } from '../src/core/template'
import { PNG, run, testContext } from './helpers'

describe('built-in catalog', () => {
  it('registers every node with unique ids and a JSON-safe catalog', () => {
    const registry = new NodeRegistry().registerAll(builtinNodes)
    const ids = builtinNodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(() => JSON.stringify(registry.catalog())).not.toThrow()
    expect(builtinNodes.map(toCatalogEntry).every((m) => !('execute' in m))).toBe(true)
  })

  it('has default values for every param that needs one', () => {
    for (const node of builtinNodes) {
      for (const p of node.params) {
        if (p.type === 'select')
          expect(p.options?.length, `${node.id}.${p.name}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('Prompt Template', () => {
  it('fills variables, dotted paths and blanks unknown names', () => {
    expect(
      renderTemplate('Hi {{ a }}, {{user.name}}! [{{missing}}]', { a: 'x', user: { name: 'Ann' } }),
    ).toBe('Hi x, Ann! []')
  })

  it('does not interpret anything beyond {{name}}', () => {
    expect(renderTemplate('{{a}} ${a} {a}', { a: '1' })).toBe('1 ${a} {a}')
  })

  it('merges the vars input with a-d', async () => {
    const out = await run(
      templateNode,
      testContext(),
      { a: 'A', vars: { topic: 'cats' } },
      { template: '{{a}}/{{topic}}' },
    )
    expect(out.text).toBe('A/cats')
  })
})

describe('Switch and Seed', () => {
  it('picks the branch', async () => {
    const t = testContext()
    expect((await run(switchNode, t, { condition: true, ifTrue: 1, ifFalse: 2 })).value).toBe(1)
    expect((await run(switchNode, t, { condition: false, ifTrue: 1, ifFalse: 2 })).value).toBe(2)
  })

  it('fixed seed is stable, random seed is not', async () => {
    const t = testContext()
    expect((await run(seedNode, t, {}, { value: 42, mode: 'fixed' })).seed).toBe(42)
    const a = (await run(seedNode, t, {}, { mode: 'random' })).seed
    const b = (await run(seedNode, t, {}, { mode: 'random' })).seed
    expect(a).not.toBe(b)
  })
})

describe('Load Image', () => {
  it('outputs the picked asset', async () => {
    const t = testContext()
    const ref = await t.assets.save(PNG, { name: 'page.png', mime: 'image/png' })
    expect((await run(loadImageNode, t, {}, { file: ref })).image).toEqual(ref)
  })

  it('explains when nothing is selected or the file is not an image', async () => {
    const t = testContext()
    await expect(run(loadImageNode, t, {}, { file: null })).rejects.toThrow(/No image selected/)
    const txt = await t.assets.save(new Uint8Array([65]), { name: 'a.txt', mime: 'text/plain' })
    await expect(run(loadImageNode, t, {}, { file: txt })).rejects.toThrow(/expected image/)
  })
})

describe('Save JSON / Save File', () => {
  it('stores pretty JSON under a safe name', async () => {
    const t = testContext()
    const { file } = await run(saveJsonNode, t, { json: { a: 1 } }, { filename: '../quiz?.json' })
    const ref = file as { name: string; mime: string; assetId: string }
    expect(ref.name).toBe('.._quiz_.json')
    expect(ref.mime).toBe('application/json')
    const text = new TextDecoder().decode(t.assets.files.get(ref.assetId)!.data)
    expect(JSON.parse(text)).toEqual({ a: 1 })
    expect(text).toContain('\n')
  })

  it('stores text and renames existing assets', async () => {
    const t = testContext()
    const text = (await run(saveFileNode, t, { data: 'hello' }, { filename: 'note' })).file as {
      name: string
      mime: string
    }
    expect(text).toMatchObject({ name: 'note.txt', mime: 'text/plain' })

    const img = await t.assets.save(PNG, { name: 'x.png', mime: 'image/png' })
    const renamed = (await run(saveFileNode, t, { data: img }, { filename: 'cover' })).file as {
      name: string
      assetId: string
    }
    expect(renamed).toMatchObject({ name: 'cover.png', assetId: img.assetId })
  })
})

describe('HTML to Text', () => {
  it('drops scripts, styles and comments and decodes entities', () => {
    expect(
      htmlToText(
        '<head><title>T</title></head><style>p{}</style><!-- c --><p>Tom &amp; Jerry &#65;&#x42; &lt;3</p><script>x()</script>',
      ),
    ).toBe('Tom & Jerry AB <3')
  })

  it('keeps paragraphs, line breaks and list items', () => {
    expect(htmlToText('<h1>Title</h1><p>One<br>two</p><ul><li>a</li><li>b</li></ul>')).toBe(
      'Title\n\nOne\ntwo\n\n- a\n- b',
    )
  })

  it('renders link URLs only when asked', () => {
    const html = '<p>See <a href="https://x.io/a?b=1&amp;c=2">the docs</a></p>'
    expect(htmlToText(html)).toBe('See the docs')
    expect(htmlToText(html, { keepLinks: true })).toBe('See the docs (https://x.io/a?b=1&c=2)')
  })

  it('runs as a node', async () => {
    const out = await run(
      htmlToTextNode,
      testContext(),
      { html: '<b>hi</b>' },
      { keepLinks: false },
    )
    expect(out.text).toBe('hi')
  })
})
