import type { ExecutionContext } from './types'

/** Reference to a binary asset on disk. Nodes pass these around instead of raw bytes. */
export interface AssetRef {
  /** Content hash (sha256 hex), so identical content yields identical refs (and cache hits). */
  assetId: string
  mime: string
  name: string
  size: number
}

export function isAssetRef(value: unknown): value is AssetRef {
  const v = value as Partial<AssetRef> | null
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.assetId === 'string' &&
    typeof v.mime === 'string' &&
    typeof v.size === 'number'
  )
}

export interface AssetStore {
  save(data: Uint8Array, meta: { name: string; mime: string }): Promise<AssetRef>
  read(assetId: string): Promise<{ ref: AssetRef; data: Uint8Array }>
}

export interface SecretStore {
  /** API key / token for a provider id (e.g. `anthropic`), or undefined when not configured. */
  get(provider: string): string | undefined
}

export interface SettingsReader {
  /** Non-secret setting (e.g. `ollamaBaseUrl`), or undefined when unset. */
  get(key: string): string | undefined
}

/** What the host injects into `RunOptions.services`. */
export interface AnyGenServices {
  assets: AssetStore
  secrets: SecretStore
  settings?: SettingsReader
}

export function getServices(ctx: Pick<ExecutionContext, 'services'>): AnyGenServices {
  const { assets, secrets, settings } = ctx.services as Partial<AnyGenServices>
  if (!assets || !secrets) throw new Error('Host did not provide asset/secret services')
  return { assets, secrets, settings }
}
