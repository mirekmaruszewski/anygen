import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createModelResolver } from '../src/ai/models'
import { chatNode, visionNode } from '../src/llm/chat'
import { structuredOutputNode } from '../src/llm/structured'
import { PNG, run, testContext } from './helpers'

/** The lmstudio: provider talks OpenAI chat-completions; check requests against a fake server. */
describe('LM Studio provider', () => {
  let server: Server
  let base: string
  let reply = 'Hello from gemma'
  const seen: { url: string; body: Record<string, unknown> }[] = []

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        seen.push({ url: req.url ?? '', body })
        const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        if (body.stream) {
          res.setHeader('content-type', 'text/event-stream')
          const chunk = (delta: object, finish: string | null = null) =>
            `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
          res.write(chunk({ role: 'assistant', content: reply }))
          res.write(chunk({}, 'stop'))
          res.end(
            `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: body.model, choices: [], usage })}\n\ndata: [DONE]\n\n`,
          )
        } else {
          res.setHeader('content-type', 'application/json')
          res.end(
            JSON.stringify({
              id: 'c',
              object: 'chat.completion',
              model: body.model,
              usage,
              choices: [
                { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: reply } },
              ],
            }),
          )
        }
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  const ctx = () => {
    const t = testContext()
    ;(t.ctx.services as Record<string, unknown>).modelResolver = createModelResolver({
      assets: t.assets,
      secrets: { get: () => undefined },
      settings: { get: (k) => (k === 'lmstudioBaseUrl' ? base : undefined) },
    })
    return t
  }

  it('chats with a local model', async () => {
    const out = await run(chatNode, ctx(), { model: 'lmstudio:gemma-3-4b', prompt: 'hi' })
    expect(out.text).toBe('Hello from gemma')
    const req = seen.at(-1)!
    expect(req.url).toBe('/v1/chat/completions')
    expect(req.body.model).toBe('gemma-3-4b')
  })

  it('sends images as image_url parts', async () => {
    const t = ctx()
    const image = await t.assets.save(PNG, { name: 'p.png', mime: 'image/png' })
    await run(visionNode, t, { model: 'lmstudio:gemma-3-4b', image, prompt: 'what is this' })
    const content = (seen.at(-1)!.body.messages as { content: unknown }[]).at(-1)!.content as {
      type: string
      image_url?: { url: string }
    }[]
    expect(content.map((p) => p.type)).toEqual(['image_url', 'text'])
    expect(content[0]!.image_url!.url).toMatch(/^data:image\/png;base64,/)
  })

  it('requests structured output as a JSON schema', async () => {
    reply = '{"n": 7}'
    const schema = {
      type: 'object',
      properties: { n: { type: 'number' } },
      required: ['n'],
      additionalProperties: false,
    }
    const out = await run(
      structuredOutputNode,
      ctx(),
      { model: 'lmstudio:gemma-3-4b', prompt: 'p' },
      { schema },
    )
    expect(out.json).toEqual({ n: 7 })
    expect(seen.at(-1)!.body.response_format).toMatchObject({ type: 'json_schema' })
  })
})
