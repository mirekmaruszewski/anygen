<script setup lang="ts">
import type { NodeMeta } from '@anygen/core'
import type { NodeRunState } from '~/utils/runState'

const props = defineProps<{
  nodeId: string | null
  title: string
  meta: NodeMeta | null
  run: NodeRunState | undefined
}>()

interface Shown {
  name: string
  kind: 'text' | 'json' | 'image' | 'audio' | 'video' | 'file'
  value: unknown
}

interface AssetLike {
  assetId: string
  mime: string
  name?: string
}

const asAsset = (value: unknown): AssetLike | null => {
  const v = value as Partial<AssetLike> | null
  return v && typeof v.assetId === 'string' && typeof v.mime === 'string' ? (v as AssetLike) : null
}

const assetUrl = (value: unknown) => {
  const asset = asAsset(value)
  return asset ? `/api/assets/${asset.assetId}` : null
}

/** Assets are previewed by their MIME type, so `any`-typed ports (Preview, Save) work too. */
function kindOf(portType: string, value: unknown): Shown['kind'] {
  const asset = asAsset(value)
  if (asset) {
    const major = asset.mime.split('/')[0]
    return major === 'image' || major === 'audio' || major === 'video' ? major : 'file'
  }
  return portType === 'text' ? 'text' : 'json'
}

const shown = computed<Shown[]>(() => {
  const outputs = props.run?.outputs
  if (!outputs || !props.meta) return []
  return props.meta.outputs
    .filter((p) => p.name in outputs)
    .map((p) => ({
      name: p.label ?? p.name,
      kind: kindOf(p.type, outputs[p.name]),
      value: outputs[p.name],
    }))
})

const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
</script>

<template>
  <aside class="inspector">
    <template v-if="nodeId && meta">
      <h3>{{ title }}</h3>
      <p v-if="meta.description" class="desc">{{ meta.description }}</p>
      <p class="status" :data-status="run?.status ?? 'idle'">
        {{ run?.status ?? 'idle' }}
        <template v-if="run?.progress?.fraction !== undefined">
          · {{ Math.round(run.progress.fraction * 100) }}%
        </template>
        <template v-if="run?.progress?.message"> · {{ run.progress.message }}</template>
      </p>
      <p v-if="run?.error" class="error">{{ run.error }}</p>
      <p v-if="run?.blockedBy" class="desc">Skipped because an upstream node failed.</p>

      <section v-for="out in shown" :key="out.name">
        <h4>{{ out.name }}</h4>
        <img v-if="out.kind === 'image'" :src="assetUrl(out.value)!" alt="" />
        <audio v-else-if="out.kind === 'audio'" :src="assetUrl(out.value)!" controls />
        <video v-else-if="out.kind === 'video'" :src="assetUrl(out.value)!" controls />
        <pre v-else-if="out.kind !== 'file'">{{ pretty(out.value) }}</pre>
        <a
          v-if="assetUrl(out.value)"
          class="download"
          :href="assetUrl(out.value)!"
          :download="asAsset(out.value)?.name"
        >
          Download {{ asAsset(out.value)?.name }}
        </a>
      </section>
      <p v-if="!shown.length && !run?.error" class="desc">No output yet. Run the workflow.</p>
    </template>
    <p v-else class="desc">Select a node to see its output.</p>
  </aside>
</template>

<style scoped>
.inspector {
  padding: 12px;
  overflow-y: auto;
  background: var(--ag-surface);
  color: var(--ag-text);
  border-left: 1px solid var(--ag-border);
}
h3,
h4 {
  margin: 0 0 6px;
}
h4 {
  margin-top: 12px;
  font-size: 0.85em;
  color: var(--ag-accent);
}
.desc {
  color: var(--ag-muted);
  font-size: 0.9em;
}
.status {
  font-size: 0.85em;
  text-transform: capitalize;
}
.status[data-status='error'],
.error {
  color: var(--ag-error);
}
.status[data-status='done'],
.status[data-status='cached'] {
  color: var(--ag-ok);
}
.status[data-status='running'] {
  color: var(--ag-accent);
}
pre {
  margin: 0;
  padding: 8px;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--ag-surface-2);
  border-radius: 8px;
  font-size: 0.85em;
}
.download {
  display: inline-block;
  margin-top: 6px;
  color: var(--ag-accent);
  font-size: 0.85em;
}
img,
video {
  max-width: 100%;
  border-radius: 3px;
}
audio {
  width: 100%;
}
</style>
