<script setup lang="ts">
import type { NodeMeta } from '@anygen/core'

const props = defineProps<{ catalog: readonly NodeMeta[] }>()
const emit = defineEmits<{ add: [typeId: string] }>()

const query = ref('')
const openCategory = ref<string | null>(null)
const dock = ref<HTMLElement | null>(null)

const categories = computed(() => {
  const byCategory = new Map<string, NodeMeta[]>()
  for (const meta of props.catalog) {
    byCategory.set(meta.category, [...(byCategory.get(meta.category) ?? []), meta])
  }
  return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))
})

const flyoutOpen = computed(() => !!openCategory.value || !!query.value.trim())

/** Nodes shown in the flyout: the open category, or every match while searching. */
const groups = computed(() => {
  const q = query.value.trim().toLowerCase()
  return categories.value
    .filter(([category]) => q || category === openCategory.value)
    .map(([category, nodes]): [string, NodeMeta[]] => [
      category,
      q
        ? nodes.filter((m) =>
            `${m.title} ${m.category} ${m.description ?? ''}`.toLowerCase().includes(q),
          )
        : nodes,
    ])
    .filter(([, nodes]) => nodes.length)
})

function toggle(category: string) {
  query.value = ''
  openCategory.value = openCategory.value === category ? null : category
}

function close() {
  openCategory.value = null
  query.value = ''
}

function onDragStart(e: DragEvent, meta: NodeMeta) {
  e.dataTransfer?.setData(NODE_DRAG_TYPE, meta.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}

function onPointerDown(e: PointerEvent) {
  if (flyoutOpen.value && dock.value && !dock.value.contains(e.target as Node)) close()
}
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKey)
})

/** Feather-style 24px icons (stroke paths); unknown categories fall back to their initial. */
const ICONS: Record<string, string> = {
  Audio: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  Generic: 'M12 2l9 5v10l-9 5-9-5V7l9-5zM12 12l9-5M12 12v10M12 12L3 7',
  Image:
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  Input: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  LLM: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z',
  Models:
    'M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14h2M20 14h2M15 13v2M9 13v2',
  Output: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  Quiz: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  Utility:
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z',
  Video: 'M23 7l-7 5 7 5V7zM3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
}
</script>

<template>
  <div ref="dock" class="dock">
    <nav class="rail" aria-label="Node categories">
      <button
        v-for="[category, nodes] in categories"
        :key="category"
        class="cat"
        :class="{ active: openCategory === category && !query }"
        :title="`${category} (${nodes.length})`"
        :aria-label="category"
        :aria-pressed="openCategory === category"
        @click="toggle(category)"
      >
        <svg
          v-if="ICONS[category]"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="ICONS[category]" />
        </svg>
        <span v-else>{{ category.charAt(0) }}</span>
      </button>
    </nav>
    <slot />

    <aside v-if="flyoutOpen" class="flyout">
      <input v-model="query" class="search" type="search" placeholder="Search nodes…" />
      <p v-if="!groups.length" class="empty">No matching nodes</p>
      <section v-for="[category, nodes] in groups" :key="category">
        <h4>{{ query ? category : `${category} (${nodes.length})` }}</h4>
        <button
          v-for="meta in nodes"
          :key="meta.id"
          class="item"
          draggable="true"
          :title="meta.description"
          @dragstart="onDragStart($event, meta)"
          @click="emit('add', meta.id)"
        >
          {{ meta.title }}
        </button>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.dock {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 52px;
}
.rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  background: var(--ag-surface);
  border: 1px solid var(--ag-border);
  border-radius: 12px;
  box-shadow: var(--ag-node-shadow);
}
.cat {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ag-text);
  font-weight: 600;
  cursor: pointer;
}
.cat:hover {
  background: var(--ag-surface-hover);
}
.cat.active {
  background: var(--ag-accent-soft);
  color: var(--ag-accent);
}
.flyout {
  position: absolute;
  top: 50%;
  left: calc(100% + 8px);
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 240px;
  max-height: calc(100vh - 140px);
  padding: 10px;
  overflow-y: auto;
  background: var(--ag-surface);
  color: var(--ag-text);
  border: 1px solid var(--ag-border);
  border-radius: 12px;
  box-shadow: var(--ag-node-shadow);
}
.search {
  padding: 8px 10px;
  border: 1px solid var(--ag-border);
  border-radius: 8px;
  background: var(--ag-surface-2);
  color: inherit;
}
h4 {
  margin: 8px 0 2px;
  font-size: 0.8em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ag-muted);
}
.item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  text-align: left;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: grab;
}
.item:hover {
  background: var(--ag-accent-soft);
}
.empty {
  color: var(--ag-muted);
  font-size: 0.9em;
}
</style>
