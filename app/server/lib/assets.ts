import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssetRef, AssetStore } from '@anygen/core'
import type { Db } from './db'

interface Row {
  id: string
  name: string
  mime: string
  size: number
}

const ID_RE = /^[0-9a-f]{64}$/

const toRef = (r: Row): AssetRef => ({
  assetId: r.id,
  name: r.name,
  mime: r.mime,
  size: Number(r.size),
})

export class AssetNotFoundError extends Error {
  constructor(assetId: string) {
    super(`Asset not found: ${assetId}`)
    this.name = 'AssetNotFoundError'
  }
}

/** Content-addressed asset store: bytes live in `dir/<sha256>`, metadata in SQLite. */
export function createAssetStore(
  db: Db,
  dir: string,
): AssetStore & {
  stat(assetId: string): AssetRef | undefined
  filePath(assetId: string): string
} {
  const filePath = (assetId: string) => {
    if (!ID_RE.test(assetId)) throw new AssetNotFoundError(assetId)
    return join(dir, assetId)
  }

  const stat = (assetId: string) => {
    if (!ID_RE.test(assetId)) return undefined
    const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as unknown as
      Row | undefined
    return row && toRef(row)
  }

  return {
    stat,
    filePath,

    async save(data, meta) {
      const id = createHash('sha256').update(data).digest('hex')
      const existing = stat(id)
      if (existing && existsSync(filePath(id))) return existing

      await mkdir(dir, { recursive: true })
      const tmp = join(dir, `${id}.tmp-${process.pid}-${Date.now()}`)
      await writeFile(tmp, data)
      await rename(tmp, filePath(id))
      db.prepare(
        'INSERT OR REPLACE INTO assets (id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, meta.name, meta.mime, data.byteLength, new Date().toISOString())
      return stat(id)!
    },

    async read(assetId) {
      const ref = stat(assetId)
      if (!ref) throw new AssetNotFoundError(assetId)
      try {
        return { ref, data: new Uint8Array(await readFile(filePath(assetId))) }
      } catch {
        throw new AssetNotFoundError(assetId)
      }
    },
  }
}

export type DiskAssetStore = ReturnType<typeof createAssetStore>
