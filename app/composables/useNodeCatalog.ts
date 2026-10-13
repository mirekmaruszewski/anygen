import type { NodeMeta } from '@anygen/core'

/** The node catalog served by `GET /api/nodes`, loaded once per session. */
export function useNodeCatalog() {
  const catalog = useState<NodeMeta[] | null>('node-catalog', () => null)
  const error = useState<string | null>('node-catalog-error', () => null)

  async function load(force = false) {
    if (catalog.value && !force) return catalog.value
    try {
      catalog.value = await $fetch<NodeMeta[]>('/api/nodes')
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
    return catalog.value
  }

  return { catalog, error, load }
}
