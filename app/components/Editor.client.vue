<script setup lang="ts">
import {
  BaklavaEditor,
  CLEAR_HISTORY_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  useBaklava,
} from '@baklavajs/renderer-vue'
import type { IEditorState } from '@baklavajs/core'
import '@baklavajs/themes/dist/syrup-dark.css'
import type { GraphInput, NodeMeta } from '@anygen/core'
import { installCatalog } from '~/composables/nodeFactory'
import { NODE_DRAG_TYPE } from '~/utils/dnd'
import { fromGraph, toGraph, type BkEditorState } from '~/utils/graphConvert'

const viewModel = useBaklava()
const editor = viewModel.editor
viewModel.settings.palette.enabled = false
viewModel.settings.enableMinimap = true

const { catalog, error: catalogError, load: loadCatalog } = useNodeCatalog()
const runStore = useRunStore()
const canvasEl = ref<HTMLElement | null>(null)
const ready = ref(false)
const notice = ref<string | null>(null)
const importInput = ref<HTMLInputElement | null>(null)

const metaById = computed(() => new Map((catalog.value ?? []).map((m) => [m.id, m])))

const currentGraph = () => toGraph(editor.save() as unknown as BkEditorState, catalog.value ?? [])

const doc = useWorkflowDoc({
  get: currentGraph,
  set(graph: GraphInput) {
    const { state, skipped } = fromGraph(graph, catalog.value ?? [])
    const warnings = editor.load(state as unknown as IEditorState)
    viewModel.commandHandler.executeCommand(CLEAR_HISTORY_COMMAND)
    const problems = [
      ...(skipped.length ? [`${skipped.length} node(s) with unknown type were dropped`] : []),
      ...warnings,
    ]
    notice.value = problems.length ? problems.join('; ') : null
  },
})

// --- selection ---------------------------------------------------------------------------------

const selected = computed(() => viewModel.displayedGraph.selectedNodes)
const selectedNode = computed(() => selected.value[0] ?? null)
const selectedMeta = computed(() =>
  selectedNode.value ? (metaById.value.get(selectedNode.value.type) ?? null) : null,
)

// --- adding nodes ------------------------------------------------------------------------------

function addNode(typeId: string, at?: { x: number; y: number }) {
  const info = editor.nodeTypes.get(typeId)
  if (!info) return
  const graph = viewModel.displayedGraph
  const rect = canvasEl.value?.getBoundingClientRect()
  const center = rect
    ? {
        x: rect.width / 2 / graph.scaling - graph.panning.x,
        y: rect.height / 2 / graph.scaling - graph.panning.y,
      }
    : { x: 0, y: 0 }
  const jitter = (graph.nodes.length % 6) * 24
  const node = graph.addNode(new info.type())
  if (node) node.position = at ?? { x: center.x - 100 + jitter, y: center.y - 60 + jitter }
}

function onDrop(e: DragEvent) {
  const typeId = e.dataTransfer?.getData(NODE_DRAG_TYPE)
  const rect = canvasEl.value?.getBoundingClientRect()
  if (!typeId || !rect) return
  const graph = viewModel.displayedGraph
  addNode(typeId, {
    x: (e.clientX - rect.left) / graph.scaling - graph.panning.x,
    y: (e.clientY - rect.top) / graph.scaling - graph.panning.y,
  })
}

// --- running -----------------------------------------------------------------------------------

const running = computed(() => runStore.state.running)
const nodeCount = computed(() => viewModel.displayedGraph.nodes.length)

const runAll = () => runStore.run(currentGraph())
const runSelected = () =>
  runStore.run(
    currentGraph(),
    selected.value.map((n) => n.id),
  )

const issueLines = computed(() =>
  runStore.issues.map((i) => {
    const node = i.nodeId ? viewModel.displayedGraph.findNodeById(i.nodeId) : undefined
    return node ? `${node.title}: ${i.message}` : i.message
  }),
)

/** Mirrors run state onto the node elements; the theme CSS below reads `data-run-status`. */
function paint(id: string, el: HTMLElement | null = document.getElementById(id)) {
  if (!el) return
  const run = runStore.state.nodes[id]
  el.dataset.runStatus = run?.status ?? 'idle'
  el.style.setProperty('--run-progress', `${Math.round((run?.progress?.fraction ?? 0) * 100)}%`)
}
const paintAll = () => viewModel.displayedGraph.nodes.forEach((n) => paint(n.id))
watch(() => runStore.state.nodes, paintAll, { deep: true })

// --- lifecycle ---------------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | undefined
const hookToken = Symbol('anygen-paint')

function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void doc.save()
  }
}

onMounted(async () => {
  const loaded = await loadCatalog()
  if (!loaded) return
  installCatalog(editor, viewModel, loaded)
  viewModel.hooks.renderNode.subscribe(hookToken, (data) => {
    paint(data.node.id, data.el)
    return data
  })
  ready.value = true
  await doc.refresh()
  doc.restoreDraft()
  timer = setInterval(doc.tick, 1500)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('keydown', onKey)
  viewModel.hooks.renderNode.unsubscribe(hookToken)
})

function onOpen(e: Event) {
  const select = e.target as HTMLSelectElement
  if (select.value) void doc.open(select.value)
  select.value = ''
}

function onImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void doc.importJson(file)
  input.value = ''
}

const exec = (command: string) => viewModel.commandHandler.executeCommand(command)
</script>

<template>
  <div class="shell">
    <header class="bar">
      <strong class="brand">AnyGen</strong>
      <input v-model="doc.name.value" class="name" aria-label="Workflow name" />
      <span class="dirty" :title="doc.dirty.value ? 'Unsaved changes' : 'Saved'">
        {{ doc.saving.value ? 'saving…' : doc.dirty.value ? '●' : '' }}
      </span>
      <button :disabled="!ready" @click="doc.newDoc()">New</button>
      <select :disabled="!ready" aria-label="Open workflow" @change="onOpen">
        <option value="">Open…</option>
        <option v-for="w in doc.list.value" :key="w.id" :value="w.id">{{ w.name }}</option>
      </select>
      <button :disabled="!ready" @click="doc.save()">Save</button>
      <button :disabled="!ready || !doc.id.value" @click="doc.remove()">Delete</button>
      <button :disabled="!ready" @click="doc.exportJson()">Export</button>
      <button :disabled="!ready" @click="importInput?.click()">Import</button>
      <input
        ref="importInput"
        type="file"
        accept="application/json,.json"
        hidden
        @change="onImport"
      />
      <span class="spacer" />
      <button :disabled="!ready" title="Undo (Ctrl+Z)" @click="exec(UNDO_COMMAND)">↶</button>
      <button :disabled="!ready" title="Redo (Ctrl+Y)" @click="exec(REDO_COMMAND)">↷</button>
      <button class="run" :disabled="!ready || running || !nodeCount" @click="runAll">▶ Run</button>
      <button :disabled="!ready || running || !selected.length" @click="runSelected">
        Run selected
      </button>
      <button :disabled="!running" @click="runStore.cancel()">Cancel</button>
    </header>

    <div v-if="catalogError" class="banner error">
      Could not load the node catalog: {{ catalogError }}
      <button @click="loadCatalog(true)">Retry</button>
    </div>
    <div
      v-if="doc.error.value || runStore.error || notice"
      class="banner"
      :class="{ error: doc.error.value || runStore.error }"
    >
      <span>{{ doc.error.value ?? runStore.error ?? notice }}</span>
      <ul v-if="issueLines.length">
        <li v-for="(line, i) in issueLines" :key="i">{{ line }}</li>
      </ul>
    </div>

    <div class="body">
      <NodePalette :catalog="(catalog as NodeMeta[] | null) ?? []" @add="addNode($event)" />
      <div ref="canvasEl" class="canvas" @dragover.prevent @drop.prevent="onDrop">
        <BaklavaEditor :view-model="viewModel" />
      </div>
      <Inspector
        :node-id="selectedNode?.id ?? null"
        :title="selectedNode?.title ?? ''"
        :meta="selectedMeta"
        :run="selectedNode ? runStore.state.nodes[selectedNode.id] : undefined"
      />
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1b202c;
  color: #fff;
  font-family: system-ui, sans-serif;
}
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #1b202c;
  border-bottom: 1px solid #2c3748;
}
.brand {
  color: #e28b46;
}
.name {
  width: 220px;
}
.spacer {
  flex: 1;
}
.dirty {
  min-width: 3.5em;
  color: #e28b46;
  font-size: 0.85em;
}
.bar button,
.bar select,
.bar .name,
.banner button {
  padding: 5px 10px;
  border: 1px solid #455670;
  border-radius: 3px;
  background: #2c3748;
  color: inherit;
  font: inherit;
}
.bar button:hover:not(:disabled) {
  background: #455670;
  cursor: pointer;
}
.bar button:disabled,
.bar select:disabled {
  opacity: 0.45;
}
.bar .run {
  background: #e28b46;
  border-color: #e28b46;
  color: #1b202c;
  font-weight: 600;
}
.banner {
  padding: 6px 12px;
  background: #3a3320;
  font-size: 0.9em;
}
.banner.error {
  background: #4a2323;
}
.banner ul {
  margin: 4px 0 0;
  padding-left: 18px;
}
.body {
  display: grid;
  grid-template-columns: 240px 1fr 320px;
  flex: 1;
  min-height: 0;
}
.canvas {
  position: relative;
  min-width: 0;
}
</style>

<style>
/* Run status on Baklava nodes (set via data-run-status, see paint() in Editor.client.vue). */
.baklava-node[data-run-status='running'] {
  outline: 2px solid #e28b46;
}
.baklava-node[data-run-status='done'],
.baklava-node[data-run-status='cached'] {
  outline: 2px solid #5fd38d;
}
.baklava-node[data-run-status='error'] {
  outline: 2px solid #ff6b6b;
}
.baklava-node[data-run-status='skipped'],
.baklava-node[data-run-status='cancelled'] {
  outline: 2px dashed #8893a5;
}
.baklava-node[data-run-status='queued'] {
  outline: 2px dotted #8893a5;
}
.baklava-node[data-run-status='running']::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  width: var(--run-progress, 0%);
  background: #e28b46;
}
/* Port colors by AnyGen port type (set by @baklavajs/interface-types). */
.baklava-node-interface[data-interface-type='text'] .__port {
  background: #6aa9ff;
}
.baklava-node-interface[data-interface-type='number'] .__port {
  background: #b48cff;
}
.baklava-node-interface[data-interface-type='boolean'] .__port {
  background: #ff8cc6;
}
.baklava-node-interface[data-interface-type='image'] .__port {
  background: #5fd38d;
}
.baklava-node-interface[data-interface-type='audio'] .__port {
  background: #ffd166;
}
.baklava-node-interface[data-interface-type='video'] .__port {
  background: #ff6b6b;
}
.baklava-node-interface[data-interface-type='json'] .__port {
  background: #e28b46;
}
</style>
