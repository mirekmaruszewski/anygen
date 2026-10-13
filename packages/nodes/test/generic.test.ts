import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { customCodeNode, runSandboxed } from '../src/generic/code'
import { httpRequestNode } from '../src/generic/http'
import { run, testContext } from './helpers'

describe('Custom Code sandbox', () => {
  const exec = (code: string, inputs: unknown = {}, timeoutMs = 2000) =>
    runSandboxed({ code, inputs, timeoutMs })

  it('runs a function body over JSON inputs', async () => {
    expect(await exec('return { sum: inputs.a + inputs.b, tags: ["x"] }', { a: 1, b: 2 })).toEqual({
      sum: 3,
      tags: ['x'],
    })
  })

  it('returns null for no return value', async () => {
    expect(await exec('const x = 1')).toBeNull()
  })

  it('cannot reach Node, the network or the file system', async () => {
    const probe = `return [typeof process, typeof require, typeof fetch, typeof globalThis.Buffer, typeof module].join()`
    expect(await exec(probe)).toBe('undefined,undefined,undefined,undefined,undefined')
  })

  it('cannot escape through constructors', async () => {
    const escape = `return String(this.constructor.constructor("return typeof process")())`
    expect(await exec(escape)).toBe('undefined')
  })

  it('treats hostile input data as data, not code', async () => {
    const evil = '"); throw new Error("injected"); ("'
    expect(await exec('return inputs.s', { s: evil })).toBe(evil)
  })

  it('stops infinite loops', async () => {
    await expect(exec('while (true) {}', {}, 200)).rejects.toThrow(/timed out/)
  })

  it('limits memory', async () => {
    await expect(
      exec('const a = []; while (true) a.push(new Array(1e6).fill(1))', {}, 5000),
    ).rejects.toThrow()
  })

  it('reports thrown errors', async () => {
    await expect(exec('throw new Error("boom")')).rejects.toThrow(/boom/)
  })

  it('works as a node', async () => {
    const out = await run(
      customCodeNode,
      testContext(),
      { a: 'hi' },
      { code: 'return inputs.a.toUpperCase()' },
    )
    expect(out.result).toBe('HI')
  })
})

describe('HTTP Request', () => {
  let server: Server
  let base: string
  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? ''
      if (url === '/json') {
        res.setHeader('content-type', 'application/json')
        res.end('{"ok":true}')
      } else if (url === '/text') {
        res.setHeader('content-type', 'text/plain')
        res.end('hello')
      } else if (url === '/echo') {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          res.setHeader('content-type', 'application/json')
          res.end(
            JSON.stringify({
              method: req.method,
              type: req.headers['content-type'],
              body: Buffer.concat(chunks).toString(),
            }),
          )
        })
      } else if (url === '/png') {
        res.setHeader('content-type', 'image/png')
        res.end(Buffer.from([1, 2, 3]))
      } else {
        res.statusCode = 404
        res.end('nope')
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it('parses JSON and text', async () => {
    const t = testContext()
    expect(await run(httpRequestNode, t, { url: `${base}/json` })).toEqual({
      body: { ok: true },
      status: 200,
    })
    expect((await run(httpRequestNode, t, { url: `${base}/text` })).body).toBe('hello')
  })

  it('posts an object body as JSON', async () => {
    const out = await run(
      httpRequestNode,
      testContext(),
      { url: `${base}/echo`, body: { a: 1 } },
      { method: 'POST' },
    )
    expect(out.body).toEqual({ method: 'POST', type: 'application/json', body: '{"a":1}' })
  })

  it('stores binary responses as assets', async () => {
    const t = testContext()
    const out = await run(httpRequestNode, t, { url: `${base}/png` })
    expect(out.body).toMatchObject({ mime: 'image/png', size: 3 })
  })

  it('fails on non-2xx unless told not to', async () => {
    const t = testContext()
    await expect(run(httpRequestNode, t, { url: `${base}/missing` })).rejects.toThrow(/HTTP 404/)
    expect(
      await run(httpRequestNode, t, { url: `${base}/missing` }, { failOnError: false }),
    ).toMatchObject({
      status: 404,
      body: 'nope',
    })
  })

  it('rejects non-http URLs and missing URLs', async () => {
    const t = testContext()
    await expect(run(httpRequestNode, t, { url: 'file:///etc/passwd' })).rejects.toThrow(
      /Only http/,
    )
    await expect(run(httpRequestNode, t, {})).rejects.toThrow(/No URL/)
  })
})
