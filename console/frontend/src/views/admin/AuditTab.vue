<template>
  <div>
    <div class="toolbar">
      <div class="actor"><UserSelect v-model="actorId" placeholder="操作人" @change="reload" /></div>
      <el-select v-model="via" placeholder="全部渠道" clearable style="width: 140px" @change="reload">
        <el-option v-for="(v, k) in SOURCE" :key="k" :label="v.label" :value="k" />
      </el-select>
      <el-input v-model="action" placeholder="动作，如 platform.op 或 user." clearable style="width: 200px" @change="reload" @clear="reload" />
    </div>
    <el-table v-loading="loading" :data="list">
      <el-table-column label="时间" width="150">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作人" min-width="120">
        <template #default="{ row }"><span class="yh-flex"><UserAvatar :user="row.actor" :size="22" />{{ row.actor?.name || '系统' }}</span></template>
      </el-table-column>
      <el-table-column label="渠道" width="100">
        <template #default="{ row }">
          <span :style="{ color: SOURCE[row.via]?.color }">{{ SOURCE[row.via]?.label || row.via || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="动作" prop="action" min-width="140" />
      <el-table-column label="对象" min-width="120">
        <template #default="{ row }">
          <span v-if="row.entityType">{{ row.entityType }} #{{ row.entityId }}</span>
          <span v-else class="yh-muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="详情" min-width="260">
        <template #default="{ row }"><div class="detail">{{ detailText(row.detail) }}</div></template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination v-model:current-page="page" :page-size="pageSize" :total="total" layout="total, prev, pager, next" size="small" @current-change="load" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import UserAvatar from '@/components/UserAvatar.vue'
import UserSelect from '@/components/UserSelect.vue'
import { adminApi } from '@/api/admin'
import { SOURCE } from '@/utils/constants'
import { formatDateTime } from '@/utils/format'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const actorId = ref(null)
const via = ref('')
const action = ref('')

function detailText(d) {
  if (d === null || d === undefined || d === '') return '-'
  if (typeof d === 'string') return d
  try { return JSON.stringify(d) } catch { return String(d) }
}

async function load() {
  loading.value = true
  try {
    const res = await adminApi.audit({ actorId: actorId.value, via: via.value, action: action.value, page: page.value, pageSize })
    list.value = res?.list || []
    total.value = res?.total || 0
  } finally {
    loading.value = false
  }
}
function reload() { page.value = 1; load() }

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.actor { width: 180px; }
.detail { font-size: 12px; color: var(--yh-text-2); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; max-height: 60px; overflow: hidden; }
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }
</style>
