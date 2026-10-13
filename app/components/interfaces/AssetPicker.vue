<script setup lang="ts">
import type { AssetRef } from '@anygen/core'

const props = defineProps<{
  intf: { name: string; accept?: string }
  modelValue: AssetRef | null
}>()
const emit = defineEmits<{ 'update:modelValue': [value: AssetRef | null] }>()

const busy = ref(false)
const error = ref('')
const input = ref<HTMLInputElement | null>(null)

const isImage = computed(() => props.modelValue?.mime.startsWith('image/'))

async function onPick(event: Event) {
  const el = event.target as HTMLInputElement
  const file = el.files?.[0]
  el.value = '' // allow picking the same file again
  if (!file) return
  busy.value = true
  error.value = ''
  try {
    const body = new FormData()
    body.append('file', file, file.name)
    const ref = await $fetch<AssetRef>('/api/assets', { method: 'POST', body })
    emit('update:modelValue', ref)
  } catch (e) {
    error.value =
      (e as { statusMessage?: string; message?: string }).statusMessage ?? 'Upload failed'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="asset-picker" @pointerdown.stop @keydown.stop>
    <div class="label">{{ intf.name }}</div>
    <img
      v-if="modelValue && isImage"
      class="thumb"
      :src="`/api/assets/${modelValue.assetId}`"
      :alt="modelValue.name"
    />
    <div v-if="modelValue" class="file" :title="modelValue.name">{{ modelValue.name }}</div>
    <div class="actions">
      <button type="button" :disabled="busy" @click="input?.click()">
        {{ busy ? 'Uploading…' : modelValue ? 'Replace' : 'Choose file…' }}
      </button>
      <button v-if="modelValue" type="button" @click="emit('update:modelValue', null)">
        Clear
      </button>
    </div>
    <div v-if="error" class="error">{{ error }}</div>
    <input
      ref="input"
      type="file"
      hidden
      :accept="intf.accept === '*/*' ? undefined : intf.accept"
      @change="onPick"
    />
  </div>
</template>

<style scoped>
.asset-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 0;
  font-size: 0.85em;
}
.label {
  color: var(--ag-muted);
}
.thumb {
  max-width: 100%;
  max-height: 140px;
  object-fit: contain;
  border-radius: 3px;
  background: var(--ag-surface-2);
}
.file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.actions {
  display: flex;
  gap: 4px;
}
button {
  flex: 1;
  padding: 3px 6px;
  color: var(--ag-text);
  background: var(--ag-surface-2);
  border: 1px solid var(--ag-border);
  border-radius: 6px;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: var(--ag-surface-hover);
}
.error {
  color: var(--ag-error);
}
</style>
