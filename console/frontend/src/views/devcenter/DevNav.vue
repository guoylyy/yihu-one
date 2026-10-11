<template>
  <nav class="dev-nav">
    <section v-for="g in groups" :key="g.category" class="group">
      <div class="group-title">{{ g.category }}</div>
      <router-link
        v-for="d in g.items"
        :key="d.slug"
        :to="d.path"
        class="item"
        :class="{ active: currentSlug === d.slug }"
        @click="emit('navigate')"
      >{{ d.slug === 'index' ? '概览' : d.title }}</router-link>
    </section>
  </nav>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { groupedDocs } from '@/devcenter/docs'

const emit = defineEmits(['navigate'])
const route = useRoute()
const groups = groupedDocs()
const currentSlug = computed(() => route.params.slug || 'index')
</script>

<style scoped>
.dev-nav { padding: 16px 12px 32px; }
.group + .group { margin-top: 18px; }
.group-title { font-size: 12px; font-weight: 600; color: var(--yh-text-3); padding: 0 10px 6px; letter-spacing: .5px; }
.item { display: block; padding: 6px 10px; border-radius: 6px; color: var(--yh-text-2); font-size: 13.5px; line-height: 1.5; }
.item:hover { background: #eef2f7; color: var(--yh-text); }
.item.active { background: var(--yh-primary-soft); color: var(--yh-primary); font-weight: 500; }
</style>
