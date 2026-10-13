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

const { theme, init: initTheme, toggle: toggleTheme } = useTheme()
onMounted(initTheme)

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
      <span class="sep" />
      <button :disabled="!ready" @click="doc.newDoc()">New</button>
      <select :disabled="!ready" aria-label="Open workflow" @change="onOpen">
        <option value="">Open…</option>
        <option v-for="w in doc.list.value" :key="w.id" :value="w.id">{{ w.name }}</option>
      </select>
      <button class="primary-soft" :disabled="!ready" @click="doc.save()">Save</button>
      <button class="danger" :disabled="!ready || !doc.id.value" @click="doc.remove()">
        Delete
      </button>
      <span class="sep" />
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
      <button
        class="theme-toggle"
        :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        @click="toggleTheme"
      >
        {{ theme === 'dark' ? '☀' : '☾' }}
      </button>
      <span class="sep" />
      <button class="run" :disabled="!ready || running || !nodeCount" @click="runAll">▶ Run</button>
      <button :disabled="!ready || running || !selected.length" @click="runSelected">
        Run selected
      </button>
      <button class="danger" :disabled="!running" @click="runStore.cancel()">Cancel</button>
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
      <div ref="canvasEl" class="canvas" @dragover.prevent @drop.prevent="onDrop">
        <BaklavaEditor :view-model="viewModel" />
        <NodePalette :catalog="(catalog as NodeMeta[] | null) ?? []" @add="addNode($event)">
          <div class="history">
            <button :disabled="!ready" title="Undo (Ctrl+Z)" @click="exec(UNDO_COMMAND)">↶</button>
            <button :disabled="!ready" title="Redo (Ctrl+Y)" @click="exec(REDO_COMMAND)">↷</button>
          </div>
        </NodePalette>
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
  background: var(--ag-bg);
  color: var(--ag-text);
  font-family: var(--ag-font);
}
.bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: var(--ag-surface);
  border-bottom: 1px solid var(--ag-border);
}
.brand {
  margin-right: 4px;
  color: var(--ag-accent);
  font-size: 1.15em;
  letter-spacing: -0.01em;
}
.spacer {
  flex: 1;
}
.sep {
  align-self: center;
  width: 1px;
  height: 20px;
  margin: 0 6px;
  background: var(--ag-border);
}
.dirty {
  min-width: 3.5em;
  color: var(--ag-accent);
  font-size: 0.85em;
}

/* Buttons: borderless ghost style, 36px high, rounded; hover tints the background. */
.bar button,
.bar select,
.bar .name,
.banner button {
  height: 36px;
  box-sizing: border-box;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--ag-text);
  font: inherit;
  font-weight: 500;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.bar button:hover:not(:disabled),
.bar select:hover:not(:disabled) {
  background: var(--ag-surface-hover);
  cursor: pointer;
}
.bar button:focus-visible,
.bar select:focus-visible,
.bar .name:focus-visible {
  outline: 2px solid var(--ag-accent);
  outline-offset: 1px;
}
.bar button:disabled,
.bar select:disabled {
  opacity: 0.4;
}
.bar .name {
  width: 220px;
  font-weight: 600;
}
.bar .name:hover {
  border-color: var(--ag-border);
}
.bar .name:focus {
  border-color: var(--ag-accent);
  background: var(--ag-surface);
}
.bar select {
  appearance: none;
  padding-right: 32px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7080' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
}
.bar .primary-soft {
  background: var(--ag-accent-soft);
  color: var(--ag-accent);
}
.bar .primary-soft:hover:not(:disabled) {
  background: var(--ag-accent-soft);
  border-color: var(--ag-accent);
}
.bar .danger:hover:not(:disabled) {
  background: var(--ag-error-bg);
  color: var(--ag-error);
}
.bar .run {
  background: var(--ag-accent);
  color: var(--ag-accent-fg);
  font-weight: 600;
  padding: 0 18px;
}
.bar .run:hover:not(:disabled) {
  background: var(--ag-accent-hover);
}
.bar .theme-toggle {
  width: 36px;
  padding: 0;
  border-radius: 50%;
  font-size: 1.1em;
}
.banner {
  padding: 6px 12px;
  background: var(--ag-warn-bg);
  font-size: 0.9em;
}
.banner.error {
  background: var(--ag-error-bg);
}
.banner ul {
  margin: 4px 0 0;
  padding-left: 18px;
}
.body {
  display: grid;
  grid-template-columns: 1fr 320px;
  flex: 1;
  min-height: 0;
}
.canvas {
  position: relative;
  min-width: 0;
}
.history {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  background: var(--ag-surface);
  border: 1px solid var(--ag-border);
  border-radius: 12px;
  box-shadow: var(--ag-node-shadow);
}
.history button {
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ag-text);
  font-size: 1.2em;
  cursor: pointer;
}
.history button:hover:not(:disabled) {
  background: var(--ag-surface-hover);
}
.history button:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>

<style>
/* Run status on Baklava nodes (set via data-run-status, see paint() in Editor.client.vue). */
.baklava-node[data-run-status='running'] {
  outline: 2px solid var(--ag-accent);
}
.baklava-node[data-run-status='done'],
.baklava-node[data-run-status='cached'] {
  outline: 2px solid var(--ag-ok);
}
.baklava-node[data-run-status='error'] {
  outline: 2px solid var(--ag-error);
}
.baklava-node[data-run-status='skipped'],
.baklava-node[data-run-status='cancelled'] {
  outline: 2px dashed var(--ag-muted);
}
.baklava-node[data-run-status='queued'] {
  outline: 2px dotted var(--ag-muted);
}
.baklava-node[data-run-status='running']::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  width: var(--run-progress, 0%);
  background: var(--ag-accent);
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
