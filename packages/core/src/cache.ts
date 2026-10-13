import { createHash } from 'node:crypto'
import type { PortValues } from './types'

export interface NodeCache {
  get(key: string): PortValues | undefined
  set(key: string, outputs: PortValues): void
  clear(): void
}

export class MemoryCache implements NodeCache {
  private readonly entries = new Map<string, PortValues>()

  get(key: string) {
    return this.entries.get(key)
  }

  set(key: string, outputs: PortValues) {
    this.entries.set(key, outputs)
  }

  clear() {
    this.entries.clear()
  }

  get size() {
    return this.entries.size
  }
}

/** Deterministic JSON: sorted object keys, binary data replaced by a content hash. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, function (this: unknown, key: string, val: unknown) {
    const raw = (this as Record<string, unknown>)[key]
    if (raw instanceof Uint8Array) {
      return { $bytes: createHash('sha256').update(raw).digest('hex') }
    }
    if (typeof val === 'bigint') return { $bigint: val.toString() }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      )
    }
    return val
  })
}

export function hashValue(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(value) ?? 'undefined')
    .digest('hex')
}
