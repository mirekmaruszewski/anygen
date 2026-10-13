import { join } from 'node:path'
import { MemoryCache, NodeRegistry, type NodeDefinition } from '@anygen/core'
import { createAssetStore } from './assets'
import { openDb } from './db'
import { createRunManager } from './runs'
import { createSecretStore } from './secrets'
import { createSettingsStore } from './settings'
import { createWorkflowStore } from './workflows'

export interface AnyGenOptions {
  /** Directory for the SQLite file, assets and the secrets key file. */
  dataDir: string
  nodes: NodeDefinition[]
  env?: Record<string, string | undefined>
  /** Use `:memory:` for tests. */
  dbFile?: string
}

/** Wires the server-side services together. The Nitro routes use a singleton of this. */
export function createAnyGen(options: AnyGenOptions) {
  const { dataDir } = options
  const db = openDb(options.dbFile ?? join(dataDir, 'anygen.sqlite'))
  const registry = new NodeRegistry().registerAll(options.nodes)
  const assets = createAssetStore(db, join(dataDir, 'assets'))
  const secrets = createSecretStore(db, join(dataDir, 'secret.key'), options.env)
  const settings = createSettingsStore(db)
  const workflows = createWorkflowStore(db)
  const runs = createRunManager({
    db,
    registry,
    // One cache for the process lifetime, so unchanged nodes are skipped across runs.
    cache: new MemoryCache(),
    services: {
      assets,
      secrets,
      settings: { get: (key) => (settings.getAll() as Record<string, string>)[key] },
    },
  })

  return { db, registry, assets, secrets, settings, workflows, runs }
}

export type AnyGen = ReturnType<typeof createAnyGen>
