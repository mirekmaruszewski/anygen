import { toCatalogEntry, type NodeDefinition, type NodeMeta } from './types'

export class NodeRegistry {
  private readonly nodes = new Map<string, NodeDefinition>()

  register(def: NodeDefinition): this {
    if (this.nodes.has(def.id)) throw new Error(`Node type "${def.id}" is already registered`)
    this.nodes.set(def.id, def)
    return this
  }

  registerAll(defs: Iterable<NodeDefinition>): this {
    for (const def of defs) this.register(def)
    return this
  }

  has(id: string): boolean {
    return this.nodes.has(id)
  }

  get(id: string): NodeDefinition | undefined {
    return this.nodes.get(id)
  }

  list(): NodeDefinition[] {
    return [...this.nodes.values()]
  }

  /** JSON-safe node catalog (no `execute`), as served to the editor. */
  catalog(): NodeMeta[] {
    return this.list().map(toCatalogEntry)
  }
}

/** Process-wide default registry. Prefer passing explicit registries in tests. */
export const defaultRegistry = new NodeRegistry()

export function registerNode(def: NodeDefinition, registry: NodeRegistry = defaultRegistry) {
  registry.register(def)
}

export function getNode(id: string, registry: NodeRegistry = defaultRegistry) {
  return registry.get(id)
}
