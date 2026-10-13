import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { speechToTextNode, textToSpeechNode } from '../src/audio/audio'
import { imageToImageNode, openaiImageNode } from '../src/image/image'
import { createModelResolver } from '../src/ai/models'
import { PNG, run, testContext } from './helpers'

/**
 * Drives the media nodes through the real OpenAI provider against a local fake API, so argument
 * mapping (size, voice, speed, image edits, uploads) is exercised without network or keys.
 */
describe('media nodes via the OpenAI provider', () => {
  let server: Server
  const seen: { url: string; body: string; type: string }[] = []
  const savedBase = process.env.OPENAI_BASE_URL

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('latin1')
        seen.push({ url: req.url ?? '', body, type: String(req.headers['content-type']) })
        if (req.url?.endsWith('/images/generations') || req.url?.endsWith('/images/edits')) {
          res.setHeader('content-type', 'application/json')
          res.end(
            JSON.stringify({
              created: 1,
              data: [{ b64_json: Buffer.from(PNG).toString('base64') }],
            }),
          )
        } else if (req.url?.endsWith('/audio/speech')) {
          res.setHeader('content-type', 'audio/mpeg')
          res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00]))
        } else if (req.url?.endsWith('/audio/transcriptions')) {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ text: 'hello transcript' }))
        } else {
          res.statusCode = 404
          res.end('{}')
        }
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })

  afterAll(async () => {
    if (savedBase === undefined) delete process.env.OPENAI_BASE_URL
    else process.env.OPENAI_BASE_URL = savedBase
    await new Promise<void>((r) => server.close(() => r()))
  })

  const withOpenAI = () => {
    const t = testContext({ secrets: { openai: 'test-key' } })
    ;(t.ctx.services as Record<string, unknown>).modelResolver = createModelResolver({
      assets: t.assets,
      secrets: { get: () => 'test-key' },
    })
    return t
  }

  it('generates an image and stores it', async () => {
    const t = withOpenAI()
    const out = await run(openaiImageNode, t, { prompt: 'a red square' }, { size: '512x512' })
    expect(out.image).toMatchObject({ mime: 'image/png', name: 'image.png' })
    const req = seen.find((r) => r.url.endsWith('/images/generations'))!
    expect(JSON.parse(req.body)).toMatchObject({ prompt: 'a red square', size: '512x512', n: 1 })
  })

  it('rejects a malformed size before calling the API', async () => {
    await expect(
      run(openaiImageNode, withOpenAI(), { prompt: 'x' }, { size: 'big' }),
    ).rejects.toThrow(/1024x1024/)
  })

  it('edits an input image', async () => {
    const t = withOpenAI()
    const image = await t.assets.save(PNG, { name: 'in.png', mime: 'image/png' })
    const out = await run(imageToImageNode, t, { image, prompt: 'make it blue' })
    expect(out.image).toMatchObject({ mime: 'image/png' })
    const req = seen.find((r) => r.url.endsWith('/images/edits'))!
    expect(req.type).toContain('multipart/form-data')
    expect(req.body).toContain('make it blue')
  })

  it('synthesizes speech', async () => {
    const t = withOpenAI()
    const out = await run(textToSpeechNode, t, { text: 'Hi there' }, { voice: 'nova', speed: 1.25 })
    expect(out.audio).toMatchObject({ mime: 'audio/mpeg', name: 'speech.mp3', size: 4 })
    const req = seen.find((r) => r.url.endsWith('/audio/speech'))!
    expect(JSON.parse(req.body)).toMatchObject({ input: 'Hi there', voice: 'nova', speed: 1.25 })
  })

  it('transcribes audio', async () => {
    const t = withOpenAI()
    const audio = await t.assets.save(new Uint8Array([1, 2, 3, 4]), {
      name: 'a.mp3',
      mime: 'audio/mpeg',
    })
    expect((await run(speechToTextNode, t, { audio })).text).toBe('hello transcript')
    expect(seen.some((r) => r.url.endsWith('/audio/transcriptions'))).toBe(true)
  })
})
