import type { GraphInput } from '@anygen/core'

export interface WorkflowSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

interface WorkflowFull extends WorkflowSummary {
  graph: GraphInput
}

const DRAFT_KEY = 'anygen:draft'

interface Draft {
  id: string | null
  name: string
  graph: GraphInput
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as Draft) : null
  } catch {
    return null
  }
}

function writeDraft(draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    // storage unavailable: autosave to the server still works for saved workflows
  }
}

/**
 * The open workflow: name, server id, saved/dirty state, autosave and import/export. The editor
 * is reached only through `io`, so this stays independent of Baklava.
 */
export function useWorkflowDoc(io: { get(): GraphInput; set(graph: GraphInput): void }) {
  const id = ref<string | null>(null)
  const name = ref('Untitled workflow')
  const dirty = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const list = ref<WorkflowSummary[]>([])
  /** Serialized graph as of the last load/save; compared against to detect edits. */
  let snapshot = ''

  const fail = (err: unknown) => {
    error.value = err instanceof Error ? err.message : String(err)
  }

  async function refresh() {
    try {
      list.value = await $fetch<WorkflowSummary[]>('/api/workflows')
    } catch (err) {
      fail(err)
    }
  }

  function loadInto(graph: GraphInput, nextId: string | null, nextName: string) {
    io.set(graph)
    id.value = nextId
    name.value = nextName
    snapshot = JSON.stringify(io.get())
    dirty.value = false
    error.value = null
    writeDraft(nextId ? { id: nextId, name: nextName, graph: io.get() } : null)
  }

  async function save() {
    saving.value = true
    try {
      const graph = io.get()
      if (id.value) {
        await $fetch(`/api/workflows/${id.value}`, {
          method: 'PUT',
          body: { name: name.value, graph },
        })
      } else {
        const created = await $fetch<WorkflowFull>('/api/workflows', {
          method: 'POST',
          body: { name: name.value, graph },
        })
        id.value = created.id
      }
      snapshot = JSON.stringify(graph)
      dirty.value = false
      error.value = null
      writeDraft(null)
      await refresh()
    } catch (err) {
      fail(err)
    } finally {
      saving.value = false
    }
  }

  async function open(workflowId: string) {
    try {
      const wf = await $fetch<WorkflowFull>(`/api/workflows/${workflowId}`)
      loadInto(wf.graph, wf.id, wf.name)
    } catch (err) {
      fail(err)
    }
  }

  async function remove() {
    if (!id.value) return
    try {
      await $fetch(`/api/workflows/${id.value}`, { method: 'DELETE' })
      newDoc()
      await refresh()
    } catch (err) {
      fail(err)
    }
  }

  function newDoc() {
    loadInto({ version: 1, nodes: [], edges: [] }, null, 'Untitled workflow')
  }

  function exportJson() {
    const body = JSON.stringify({ name: name.value, graph: io.get() }, null, 2)
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.value.replace(/[^\w.-]+/g, '_') || 'workflow'}.anygen.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as {
        name?: string
        graph?: GraphInput
      } & GraphInput
      const graph = parsed.graph ?? parsed
      if (!Array.isArray(graph.nodes)) throw new Error('Not an AnyGen workflow file')
      loadInto(graph, null, parsed.name ?? file.name.replace(/\.json$/i, ''))
      dirty.value = true
      snapshot = ''
    } catch (err) {
      fail(err)
    }
  }

  /** Restores the unsaved draft from the previous session, if any. Returns whether it did. */
  function restoreDraft() {
    const draft = readDraft()
    if (!draft) return false
    loadInto(draft.graph, draft.id, draft.name)
    dirty.value = true
    snapshot = ''
    return true
  }

  /** Detects edits (including node moves, which Baklava has no event for) and autosaves. */
  function tick() {
    if (saving.value) return
    const graph = io.get()
    const json = JSON.stringify(graph)
    if (json === snapshot) return
    dirty.value = true
    writeDraft({ id: id.value, name: name.value, graph })
    if (id.value) void save()
    else snapshot = json // draft written; only a save clears `dirty`
  }

  return {
    id,
    name,
    dirty,
    saving,
    error,
    list,
    refresh,
    save,
    open,
    remove,
    newDoc,
    exportJson,
    importJson,
    restoreDraft,
    tick,
  }
}
