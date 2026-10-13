/** Node catalog: JSON-safe definitions (no execute functions) the editor builds its nodes from. */
export default defineApiHandler(() => useAnyGen().registry.catalog())
