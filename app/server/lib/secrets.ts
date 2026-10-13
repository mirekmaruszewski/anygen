import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SecretStore } from '@anygen/core'
import type { Db } from './db'

export interface ProviderInfo {
  id: string
  label: string
  /** Environment variable that can supply the key (takes precedence over a stored key). */
  envVar: string
}

export const PROVIDERS: readonly ProviderInfo[] = [
  { id: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY' },
  { id: 'replicate', label: 'Replicate', envVar: 'REPLICATE_API_TOKEN' },
  { id: 'fal', label: 'fal', envVar: 'FAL_KEY' },
]

export interface ProviderStatus {
  id: string
  label: string
  configured: boolean
  /** Where the active key comes from. Never includes the key itself. */
  source: 'env' | 'stored' | null
  envVar: string
}

const settingKey = (provider: string) => `secret:${provider}`

function loadOrCreateKey(keyFile: string): Buffer {
  if (existsSync(keyFile)) return Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64')
  mkdirSync(dirname(keyFile), { recursive: true })
  const key = randomBytes(32)
  writeFileSync(keyFile, key.toString('base64'), { mode: 0o600 })
  return key
}

/**
 * API keys are read from the environment first, then from the database, where they are stored
 * AES-256-GCM encrypted with a local key file. Keys never leave the server.
 */
export function createSecretStore(
  db: Db,
  keyFile: string,
  env: Record<string, string | undefined> = process.env,
) {
  let key: Buffer | undefined
  const getKey = () => (key ??= loadOrCreateKey(keyFile))

  const encrypt = (plain: string) => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
  }

  const decrypt = (blob: string) => {
    const raw = Buffer.from(blob, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', getKey(), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  }

  const stored = (provider: string): string | undefined => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey(provider)) as
      { value: string } | undefined
    if (!row) return undefined
    try {
      return decrypt(row.value)
    } catch {
      return undefined // key file replaced or data corrupted: treat as not configured
    }
  }

  const info = (provider: string) => {
    const found = PROVIDERS.find((p) => p.id === provider)
    if (!found) throw new Error(`Unknown provider "${provider}"`)
    return found
  }

  const store: SecretStore & {
    set(provider: string, apiKey: string): void
    delete(provider: string): void
    status(): ProviderStatus[]
  } = {
    get(provider) {
      const envValue = env[info(provider).envVar]
      return envValue || stored(provider)
    },

    set(provider, apiKey) {
      info(provider)
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
        settingKey(provider),
        encrypt(apiKey),
      )
    },

    delete(provider) {
      info(provider)
      db.prepare('DELETE FROM settings WHERE key = ?').run(settingKey(provider))
    },

    status() {
      return PROVIDERS.map((p) => {
        const source = env[p.envVar] ? 'env' : stored(p.id) ? 'stored' : null
        return { id: p.id, label: p.label, envVar: p.envVar, configured: source !== null, source }
      })
    },
  }
  return store
}

export type DiskSecretStore = ReturnType<typeof createSecretStore>
