import { defineNode } from '@anygen/core'
import { extForMime, saveAsset } from '../util/assets'

const MAX_RESPONSE_BYTES = 50 * 1024 * 1024

function parseHeaders(value: unknown): Record<string, string> {
  if (value === undefined || value === null || value === '') return {}
  if (typeof value === 'string') throw new Error('The headers param is not valid JSON')
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Headers must be a JSON object of name: value pairs')
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]))
}

async function readLimited(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_RESPONSE_BYTES) throw new Error('Response is larger than 50 MB')
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = res.body?.getReader()
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('Response is larger than 50 MB')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

export const httpRequestNode = defineNode({
  id: 'generic/http',
  title: 'HTTP Request',
  category: 'Generic',
  description:
    'Calls any HTTP(S) API. JSON responses are parsed, text is returned as text, and binary responses are stored as assets. Requests run from the AnyGen server, so they can reach anything the server can.',
  inputs: [
    { name: 'url', type: 'text', required: false },
    { name: 'body', type: 'any', required: false },
  ],
  outputs: [
    { name: 'body', type: 'any' },
    { name: 'status', type: 'number' },
  ],
  params: [
    { name: 'url', type: 'text', label: 'URL (when the input is unconnected)', default: '' },
    {
      name: 'method',
      type: 'select',
      label: 'Method',
      default: 'GET',
      options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
    { name: 'headers', type: 'json', label: 'Headers', default: {} },
    { name: 'timeoutSeconds', type: 'number', label: 'Timeout (s)', default: 60, min: 1, max: 600 },
    { name: 'failOnError', type: 'boolean', label: 'Fail on non-2xx status', default: true },
  ],
  // The remote state can change between runs, so never serve a cached response.
  cache: false,
  execute: async (ctx, inputs, params) => {
    const raw = String(inputs.url || params.url || '').trim()
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new Error(raw ? `Invalid URL "${raw}"` : 'No URL given')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Only http and https URLs are allowed (got ${url.protocol})`)
    }

    const headers = parseHeaders(params.headers)
    const method = String(params.method ?? 'GET')
    let body: string | undefined
    if (method !== 'GET' && inputs.body !== undefined) {
      if (typeof inputs.body === 'string') {
        body = inputs.body
      } else {
        body = JSON.stringify(inputs.body)
        if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
          headers['Content-Type'] = 'application/json'
        }
      }
    }

    const timeout = Math.min(600, Math.max(1, Number(params.timeoutSeconds ?? 60))) * 1000
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeout)]),
    })
    const bytes = await readLimited(res)

    if (!res.ok && params.failOnError !== false) {
      const snippet = new TextDecoder().decode(bytes.slice(0, 300))
      throw new Error(`HTTP ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ''}`)
    }

    // No Content-Type usually means a plain error body, not a file.
    const mime = (res.headers.get('content-type') ?? 'text/plain')
      .split(';')[0]!
      .trim()
      .toLowerCase()
    let out: unknown
    if (mime === 'application/json' || mime.endsWith('+json')) {
      const text = new TextDecoder().decode(bytes)
      try {
        out = JSON.parse(text)
      } catch {
        out = text
      }
    } else if (mime.startsWith('text/')) {
      out = new TextDecoder().decode(bytes)
    } else {
      const last = url.pathname.split('/').filter(Boolean).pop()
      out = await saveAsset(ctx, bytes, {
        name: last && /\.\w+$/.test(last) ? last : `response.${extForMime(mime)}`,
        mime,
      })
    }
    return { body: out, status: res.status }
  },
})
