<script setup lang="ts">
import type { NodeMeta } from '@anygen/core'

const props = defineProps<{ catalog: readonly NodeMeta[] }>()
const emit = defineEmits<{ add: [typeId: string] }>()

const query = ref('')

const groups = computed(() => {
  const q = query.value.trim().toLowerCase()
  const byCategory = new Map<string, NodeMeta[]>()
  for (const meta of props.catalog) {
    const haystack = `${meta.title} ${meta.category} ${meta.description ?? ''}`.toLowerCase()
    if (q && !haystack.includes(q)) continue
    byCategory.set(meta.category, [...(byCategory.get(meta.category) ?? []), meta])
  }
  return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))
})

function onDragStart(e: DragEvent, meta: NodeMeta) {
  e.dataTransfer?.setData(NODE_DRAG_TYPE, meta.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <aside class="palette">
    <input v-model="query" class="search" type="search" placeholder="Search nodes…" />
    <p v-if="!groups.length" class="empty">No matching nodes</p>
    <details
      v-for="[category, nodes] in groups"
      :key="category"
      :open="!!query || undefined"
      class="group"
    >
      <summary>{{ category }} ({{ nodes.length }})</summary>
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
    </details>
  </aside>
</template>

<style scoped>
.palette {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow-y: auto;
  background: #1b202c;
  color: #fff;
  border-right: 1px solid #2c3748;
}
.search {
  padding: 6px 8px;
  border: 1px solid #455670;
  border-radius: 3px;
  background: #2c3748;
  color: inherit;
}
.group summary {
  cursor: pointer;
  padding: 4px 0;
  font-weight: 600;
  color: #e28b46;
}
.item {
  display: block;
  width: 100%;
  margin: 2px 0;
  padding: 6px 8px;
  text-align: left;
  border: 0;
  border-radius: 3px;
  background: #2c3748;
  color: inherit;
  cursor: grab;
}
.item:hover {
  background: #455670;
}
.empty {
  color: #8893a5;
  font-size: 0.9em;
}
</style>
