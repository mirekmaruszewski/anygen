import { resolve } from 'node:path'
import { builtinNodes, loadModelNodes } from '@anygen/nodes'
import { createAnyGen, type AnyGen } from '../lib/context'

let instance: AnyGen | undefined

/** Lazily-created server singleton: database, node registry, stores and run manager. */
export function useAnyGen(): AnyGen {
  instance ??= createAnyGen({
    dataDir: process.env.ANYGEN_DATA_DIR ?? resolve(process.cwd(), '..', 'data'),
    nodes: builtinNodes,
    extraNodes: loadModelNodes(
      process.env.ANYGEN_MODELS_FILE ?? resolve(process.cwd(), '..', 'models.json'),
    ),
  })
  return instance
}
