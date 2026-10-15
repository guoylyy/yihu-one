<template>
  <div v-loading="loading">
    <ThemeEditor
      v-if="f && draft.appearance"
      v-model="draft.appearance.theme"
      :catalog="f.catalog"
      :name="app.workspaceName"
      :logo="app.config?.logo || ''"
    />
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useAppStore } from '@/stores/app'
import ThemeEditor from '@/components/ThemeEditor.vue'
import { useSettings } from '../useSettings'

const emit = defineEmits(['changed'])
const app = useAppStore()
const { draft, loading, load, save: saveGroup, field } = useSettings('settings')
const f = computed(() => field('appearance', 'theme'))

async function save() {
  await saveGroup('appearance', ['theme'])
  await app.load(true)
  emit('changed')
}
defineExpose({ save })
onMounted(load)
</script>
