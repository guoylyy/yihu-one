<template>
  <div>
    <!-- 宿主机 agent 状态：控制台里的插拔操作都由它执行 -->
    <div class="agent" :class="agentClass">
      <span class="agent-dot"></span>
      <template v-if="platform?.agent?.online">
        <b>yh agent 在线</b>
        <span class="yh-muted">最近上报 {{ fromNow(platform.agent.lastSeenAt) }}</span>
        <span v-if="platform.running" class="agent-run">正在{{ OP_KIND[platform.running.kind] }} {{ platform.running.appCode }}</span>
        <span v-if="platform.pending" class="yh-muted">· 排队 {{ platform.pending }} 个</span>
      </template>
      <template v-else-if="platform">
        <b>yh agent 未连接</b>
        <span class="yh-muted">安装、发布等操作会排队，等宿主机上运行 <code>yh agent</code>（或 <code>yh autostart</code>）后执行</span>
      </template>
      <div class="yh-grow"></div>
      <a href="/dev/deploy" target="_blank" rel="noopener" class="small">应用开发与发布规范</a>
    </div>

    <div class="toolbar">
      <el-button type="primary" :icon="Download" @click="openInstall">从 Git 安装应用</el-button>
      <el-button :icon="Link" @click="openEdit(null)">登记外部应用</el-button>
      <div class="yh-grow"></div>
      <el-input v-model="keyword" placeholder="搜索应用" clearable :prefix-icon="Search" style="width: 200px" />
    </div>

    <el-table v-loading="loading" :data="shown" row-key="id">
      <el-table-column label="应用" min-width="210">
        <template #default="{ row }">
          <div class="yh-flex">
            <AppIcon :icon="row.icon" :name="row.name" :color="row.iconColor" :size="34" />
            <div class="yh-grow" style="min-width: 0">
              <div class="yh-flex">
                <span class="yh-ellipsis">{{ row.name }}</span>
                <span v-if="row.mcpUrl" class="yh-tag-ai" title="AI 助手可以调用该应用的工具">✦ AI</span>
              </div>
              <div class="yh-muted small">{{ row.code }}<template v-if="row.category"> · {{ row.category }}</template></div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="104">
        <template #default="{ row }">
          <el-tag v-if="row.managed" size="small" effect="plain" type="primary">平台托管</el-tag>
          <el-tag v-else size="small" effect="plain" type="info">{{ APP_TYPE[row.type] || row.type }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="版本" min-width="170">
        <template #default="{ row }">
          <template v-if="row.managed">
            <div v-if="row.runtime?.version" class="app-ver">v{{ row.runtime.version }}</div>
            <div v-else class="yh-muted small" title="在 yh-app.json 或 package.json 里写 version，这里就会显示">未标版本号</div>
            <div class="yh-muted small">
              <span v-if="row.runtime?.commit" class="ver" :title="row.runtime.commitAt ? `提交于 ${formatDateTime(row.runtime.commitAt)}` : ''">{{ row.runtime.commit }}</span>
              <span v-if="row.runtime?.deployedAt" :title="formatDateTime(row.runtime.deployedAt)"> 发布于 {{ fromNow(row.runtime.deployedAt) }}</span>
            </div>
          </template>
          <span v-else class="yh-muted small">—</span>
        </template>
      </el-table-column>
      <el-table-column label="运行" min-width="170">
        <template #default="{ row }">
          <template v-if="row.managed">
            <div class="yh-flex run">
              <span class="dot" :class="runClass(row)"></span>
              <span>{{ runText(row) }}</span>
            </div>
            <div class="yh-muted small">
              <template v-if="busyOf(row)">{{ OP_KIND[busyOf(row).kind] }}{{ busyOf(row).status === 'PENDING' ? '排队中' : '中…' }}</template>
              <template v-else>{{ [row.branch && `跟踪 ${row.branch}`, row.runtime?.memory && `内存 ${row.runtime.memory}`].filter(Boolean).join(' · ') }}</template>
            </div>
            <el-tag v-if="row.mounts?.length" class="mount-tag" size="small" effect="plain" :type="mountsUnset(row).length ? 'danger' : 'info'" title="宿主目录挂载：点开看配置和命令" @click="openHistory(row)">
              {{ mountsUnset(row).length ? `挂载 ${mountsUnset(row).length} 未配置` : `挂载 ${row.mounts.length} 已配置` }}
            </el-tag>
          </template>
          <span v-else class="yh-muted small yh-ellipsis" :title="row.url">{{ row.url }}</span>
        </template>
      </el-table-column>
      <el-table-column label="可见范围" min-width="120">
        <template #default="{ row }"><span class="small" :class="{ 'yh-muted': !row.visibility }">{{ visText(row) }}</span></template>
      </el-table-column>
      <el-table-column label="状态" width="72">
        <template #default="{ row }">
          <el-tag size="small" :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status === 'ACTIVE' ? '启用' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="250" fixed="right">
        <template #default="{ row }">
          <template v-if="row.managed">
            <el-button link type="primary" :disabled="!!busyOf(row)" @click="op(row, 'DEPLOY')">发布</el-button>
            <el-button v-if="row.status === 'ACTIVE'" link type="primary" :disabled="!!busyOf(row)" @click="op(row, 'RESTART')">重启</el-button>
            <el-button v-else link type="success" :disabled="!!busyOf(row)" @click="op(row, 'START')">启动</el-button>
            <el-button link type="primary" @click="op(row, 'LOGS')">日志</el-button>
          </template>
          <template v-else>
            <el-button link type="primary" @click="openEdit(row)">设置</el-button>
            <el-button link type="primary" @click="openUsage(row)">使用数据</el-button>
          </template>
          <el-dropdown trigger="click" @command="c => more(row, c)">
            <el-button link type="primary">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <template v-if="row.managed">
                  <el-dropdown-item command="edit">设置（可见范围等）</el-dropdown-item>
                  <el-dropdown-item command="usage">使用数据</el-dropdown-item>
                  <el-dropdown-item command="history">操作与发布记录</el-dropdown-item>
                  <el-dropdown-item command="open" :disabled="!row.url">打开应用</el-dropdown-item>
                  <el-dropdown-item v-if="row.status === 'ACTIVE'" command="STOP" divided :disabled="!!busyOf(row)">停用（保留数据）</el-dropdown-item>
                  <el-dropdown-item command="REMOVE" :disabled="!!busyOf(row)"><span class="danger">移除应用</span></el-dropdown-item>
                </template>
                <template v-else>
                  <el-dropdown-item v-if="row.type === 'SSO'" command="secret">重置密钥</el-dropdown-item>
                  <el-dropdown-item command="open" :disabled="!row.url">打开应用</el-dropdown-item>
                  <el-dropdown-item command="delete" divided><span class="danger">删除登记</span></el-dropdown-item>
                </template>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <AppUsageDrawer v-model="usageDrawer.visible" :app="usageDrawer.app" />
    <OpLogDrawer v-model="logDrawer.visible" :op-id="logDrawer.opId" :app="logDrawer.app" @done="onOpDone" />

    <!-- 从 Git 安装 -->
    <el-dialog v-model="inst.visible" title="从 Git 安装应用" width="560px">
      <el-alert type="info" :closable="false" show-icon>
        <template #title>仓库根目录需要有 <code>yh-app.json</code>（应用清单）和 <code>Dockerfile</code>。宿主机要能拉取这个仓库（私有仓库先配好部署公钥）。</template>
      </el-alert>
      <el-form ref="instRef" :model="inst.form" :rules="instRules" label-width="96px" style="margin-top: 16px">
        <el-form-item label="仓库地址" prop="git"><el-input v-model="inst.form.git" placeholder="git@gitee.com:org/repo.git 或 https://…" /></el-form-item>
        <el-form-item label="应用 code" prop="code">
          <el-input v-model="inst.form.code" placeholder="与清单里的 code 一致，如 kaoqin" />
          <div class="yh-muted small">访问地址将是 {{ publicBase }}/apps/{{ inst.form.code || '<code>' }}/</div>
        </el-form-item>
        <el-form-item label="分支"><el-input v-model="inst.form.branch" placeholder="默认用清单 deploy.branch，没有则用仓库默认分支" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="inst.visible = false">取消</el-button>
        <el-button type="primary" :loading="inst.saving" @click="install">安装</el-button>
      </template>
    </el-dialog>

    <!-- 操作与发布记录 -->
    <el-drawer v-model="hist.visible" :title="`${hist.app?.name || ''} · 操作与发布记录`" size="560px">
      <div v-loading="hist.loading">
        <!-- 配置在宿主机上做（yh mount），控制台只显示 yh 上报的状态 -->
        <template v-if="hist.app?.mounts?.length">
          <div class="sec-title">宿主目录挂载 <span class="yh-muted small">（在宿主机的平台目录里执行命令配置）</span></div>
          <div v-for="m in hist.app.mounts" :key="m.name" class="mount">
            <div class="yh-flex">
              <b>{{ m.name }}</b>
              <span class="yh-grow yh-muted small">→ {{ m.container }} · {{ m.mode === 'rw' ? '读写' : '只读' }} · {{ m.required ? '必需' : '可选' }}</span>
              <el-tag size="small" effect="plain" :type="m.configured ? 'info' : 'danger'">{{ m.configured ? '已配置' : '未配置' }}</el-tag>
            </div>
            <div v-if="m.description" class="yh-muted small">{{ m.description }}</div>
            <div class="small mount-path">{{ m.hostPath || '还没有指定宿主路径' }}</div>
            <div v-if="m.problem" class="small danger">{{ m.problem }}</div>
            <div class="cred-row"><code>{{ mountCmd(hist.app, m) }}</code><el-button size="small" @click="copy(mountCmd(hist.app, m))">复制</el-button></div>
          </div>
          <div style="margin-bottom: 20px"></div>
        </template>
        <div class="sec-title">控制台操作</div>
        <div v-if="!hist.ops.length" class="yh-empty small">暂无</div>
        <div v-for="o in hist.ops" :key="o.id" class="hist-row" @click="showLog(o, hist.app)">
          <el-tag size="small" :type="OP_STATUS[o.status]?.type">{{ OP_STATUS[o.status]?.label }}</el-tag>
          <span class="yh-grow">{{ OP_KIND[o.kind] }}<span class="yh-muted"> · {{ o.requestedBy?.name || '系统' }}</span></span>
          <span class="yh-muted small">{{ formatDateTime(o.createdAt) }}</span>
        </div>
        <div class="sec-title" style="margin-top: 20px">发布记录 <span class="yh-muted small">（含推送 release 分支触发的自动发布）</span></div>
        <div v-if="!hist.deploys.length" class="yh-empty small">暂无</div>
        <div v-for="d in hist.deploys" :key="d.id" class="hist-row static">
          <el-tag size="small" :type="DEPLOY_RESULT[d.result] || 'info'">{{ d.result }}</el-tag>
          <span class="yh-grow yh-ellipsis" :title="d.subject"><code>{{ d.version }}</code> {{ d.subject }}<span class="yh-muted"> · {{ d.author }}</span></span>
          <span class="yh-muted small">{{ d.trigger }} · {{ formatDateTime(d.createdAt) }}</span>
        </div>
      </div>
    </el-drawer>

    <!-- 设置 / 登记 -->
    <el-dialog v-model="dlg.visible" :title="dlg.id ? `设置「${dlg.form.name}」` : '登记外部应用'" width="620px" top="6vh">
      <el-alert v-if="dlg.managed" type="info" :closable="false" show-icon style="margin-bottom: 16px"
        title="平台托管的应用：名称、地址、MCP 等以代码里的 yh-app.json 为准（每次发布同步）；这里可以换图标，改可见范围和工作台设置。" />
      <el-form ref="formRef" :model="dlg.form" :rules="rules" label-width="100px">
        <el-form-item v-if="dlg.managed" label="图标">
          <div class="managed-icon">
            <IconPicker v-model:icon="dlg.form.icon" v-model:color="dlg.form.iconColor" :name="dlg.form.name" />
            <div class="yh-muted small">
              <template v-if="dlg.iconCustom">
                已换成自定义图标，之后发布不会被代码里的图标覆盖。
                <el-button v-if="dlg.manifestIcon !== null" link type="primary" size="small" @click="resetIcon">恢复为代码里的图标</el-button>
              </template>
              <template v-else>现在用的是代码里 yh-app.json 的图标；在这里换了以后，发布不再覆盖它。</template>
              <span v-if="dlg.iconReset" class="reset-tip">（保存后恢复）</span>
            </div>
          </div>
        </el-form-item>
        <template v-if="!dlg.managed">
          <el-form-item label="类型" prop="type">
            <el-radio-group v-model="dlg.form.type" :disabled="!!dlg.id">
              <el-radio-button value="SSO">统一认证</el-radio-button>
              <el-radio-button value="LINK">链接</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="编码" prop="code"><el-input v-model="dlg.form.code" placeholder="英文唯一标识，如 crm" :disabled="!!dlg.id" /></el-form-item>
          <el-form-item label="名称" prop="name"><el-input v-model="dlg.form.name" /></el-form-item>
          <el-form-item label="图标">
            <IconPicker v-model:icon="dlg.form.icon" v-model:color="dlg.form.iconColor" :name="dlg.form.name" />
          </el-form-item>
          <el-form-item label="分类"><el-input v-model="dlg.form.category" placeholder="如 业务 / 办公 / 工具" /></el-form-item>
          <el-form-item label="介绍"><el-input v-model="dlg.form.description" type="textarea" :rows="2" /></el-form-item>
          <el-form-item label="访问地址" prop="url"><el-input v-model="dlg.form.url" placeholder="https://" /></el-form-item>
          <el-form-item v-if="dlg.form.type === 'SSO'" label="回调地址">
            <el-input v-model="dlg.form.redirectUrisText" type="textarea" :rows="3" placeholder="允许的 redirect_uri，每行一个" />
          </el-form-item>
          <el-form-item label="MCP 地址">
            <el-input v-model="dlg.form.mcpUrl" placeholder="选填，配置后 AI 助手可调用该应用的工具" />
          </el-form-item>
          <el-form-item label="AI token 配额">
            <el-input-number v-model="dlg.form.llmDailyTokenLimit" :min="0" :max="100000000" controls-position="right" value-on-clear="null" style="width: 200px" />
            <span class="yh-muted small" style="margin-left: 8px">大模型每日 token 上限；留空 = 全局默认，0 = 不限</span>
          </el-form-item>
        </template>
        <!-- 多个空间时：应用属于哪个空间、还分享给哪些空间（不在这些空间里的人看不到它） -->
        <template v-if="multiSpace">
          <el-form-item label="所属空间">
            <el-select v-model="dlg.form.spaceId" style="width: 100%">
              <el-option v-for="sp in spaces" :key="sp.id" :label="sp.name" :value="sp.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="也给这些空间用">
            <el-select v-model="dlg.form.extraSpaceIds" multiple clearable style="width: 100%" placeholder="不选 = 只在所属空间">
              <el-option v-for="sp in spaces.filter(x => x.id !== dlg.form.spaceId)" :key="sp.id" :label="sp.name" :value="sp.id" />
            </el-select>
            <div class="yh-muted small">分享给别的空间后，那边的人照样按下面的可见范围再筛一次；应用通过统一登录能拿到用户所在的空间，要自己按空间分开数据（轻应用平台自动分开）</div>
          </el-form-item>
        </template>
        <el-form-item label="可见范围">
          <div style="width: 100%">
            <el-radio-group v-model="dlg.form.visAll">
              <el-radio :value="true">所有人</el-radio>
              <el-radio :value="false">指定范围</el-radio>
            </el-radio-group>
            <div v-if="!dlg.form.visAll" class="vis-box">
              <el-tree-select v-model="dlg.form.visDeptIds" :data="depts" :props="{ label: 'name', children: 'children', value: 'id' }" node-key="id" multiple check-strictly filterable clearable placeholder="部门" style="width: 100%" />
              <UserSelect v-model="dlg.form.visUserIds" multiple :initial="dlg.visUserInitial" placeholder="指定用户" />
              <el-checkbox-group v-model="dlg.form.visRoles">
                <el-checkbox value="ADMIN">管理员</el-checkbox>
                <el-checkbox value="LEADER">部门负责人</el-checkbox>
                <el-checkbox value="MEMBER">所有成员</el-checkbox>
              </el-checkbox-group>
              <div class="yh-muted small">满足任一条件即可见；管理员总是能看到</div>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="默认安装">
          <el-switch v-model="dlg.form.isDefault" />
          <span class="yh-muted small" style="margin-left: 8px">新用户的工作台默认放上这个应用</span>
        </el-form-item>
        <el-form-item v-if="!dlg.managed" label="启用"><el-switch v-model="dlg.form.active" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="dlg.form.sort" :min="0" :max="999" controls-position="right" /></el-form-item>
        <el-form-item label="负责人">
          <UserSelect v-model="dlg.form.ownerId" :initial="dlg.ownerInitial" />
          <div class="yh-muted small">负责人能看这个应用的使用数据</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 密钥（只显示一次） -->
    <el-dialog v-model="secret.visible" title="应用凭证" width="520px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon title="Client Secret 只显示这一次，请立即复制并妥善保存。关闭后无法再次查看，只能重置。" />
      <div class="cred">
        <div class="cred-label">Client ID</div>
        <div class="cred-row"><code>{{ secret.clientId }}</code><el-button size="small" @click="copy(secret.clientId)">复制</el-button></div>
        <div class="cred-label">Client Secret</div>
        <div class="cred-row"><code>{{ secret.clientSecret }}</code><el-button size="small" type="primary" @click="copy(secret.clientSecret)">复制</el-button></div>
        <div class="cred-label">OIDC 发现地址 <span class="cred-hint">现成系统（GitLab、Grafana 等）用「通用 OIDC / OAuth2」登录时填它</span></div>
        <div class="cred-row"><code>{{ discoveryUrl }}</code><el-button size="small" @click="copy(discoveryUrl)">复制</el-button></div>
      </div>
      <template #footer>
        <el-button type="primary" @click="secret.visible = false">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Link, Search, ArrowDown } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import IconPicker from '@/components/IconPicker.vue'
import UserSelect from '@/components/UserSelect.vue'
import { adminApi, platformApi } from '@/api/admin'
import { orgApi } from '@/api/org'
import { useAppStore } from '@/stores/app'
import { useUserStore } from '@/stores/user'
import AppUsageDrawer from './AppUsageDrawer.vue'
import OpLogDrawer from './OpLogDrawer.vue'
import { APP_TYPE, OP_KIND, OP_STATUS, DEPLOY_RESULT } from '@/utils/constants'
import { copyText, formatDateTime, fromNow } from '@/utils/format'

const appStore = useAppStore()
const list = ref([])
const loading = ref(false)
const keyword = ref('')
const platform = ref(null)
const activeOps = ref([])
const depts = ref([])
const deptName = computed(() => {
  const m = new Map()
  const walk = ns => ns.forEach(n => { m.set(n.id, n.name); walk(n.children || []) })
  walk(depts.value)
  return m
})
const publicBase = computed(() => window.location.origin)

const shown = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return list.value.filter(a => !k || `${a.name} ${a.code} ${a.category || ''}`.toLowerCase().includes(k))
})
const agentClass = computed(() => (platform.value?.agent?.online ? 'on' : platform.value ? 'off' : ''))

// ---------- 列表与状态 ----------
async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const [apps, st, ops] = await Promise.all([adminApi.apps(), platformApi.status(), platformApi.ops({ limit: 20 })])
    list.value = apps || []
    platform.value = st
    activeOps.value = (ops || []).filter(o => o.status === 'PENDING' || o.status === 'RUNNING')
  } finally {
    loading.value = false
  }
}
const busyOf = row => activeOps.value.find(o => o.appCode === row.code)
const mountsUnset = row => (row.mounts || []).filter(m => !m.configured)
const mountCmd = (row, m) => `yh mount ${row.code} ${m.name} ${m.configured ? `"${m.hostPath}"` : '<宿主路径>'}`

function runClass(row) {
  const r = row.runtime
  if (busyOf(row)) return 'busy'
  if (row.status !== 'ACTIVE') return 'off'
  if (!r) return 'unknown'
  return r.health === 'ok' ? 'ok' : 'bad'
}
function runText(row) {
  const r = row.runtime
  if (row.status !== 'ACTIVE') return '已停用'
  if (!r) return '未上报'
  if (r.state !== 'running') return r.state === 'missing' ? '未部署' : `容器 ${r.state}`
  return r.health === 'ok' ? '运行正常' : `健康检查失败${r.health && r.health !== 'bad' ? `（${r.health}）` : ''}`
}
function visText(row) {
  const v = row.visibility
  if (!v) return '所有人'
  const parts = []
  if (v.deptIds?.length) parts.push(v.deptIds.map(id => deptName.value.get(Number(id)) || `部门${id}`).join('、'))
  if (v.userIds?.length) parts.push(`${v.userIds.length} 人`)
  if (v.roles?.includes('MEMBER')) parts.push('所有成员')
  else if (v.roles?.includes('ADMIN')) parts.push('管理员')
  return parts.join('；') || '仅管理员'
}

// 有操作在进行时自动刷新
let timer = null
function schedule() {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    if (activeOps.value.length || !platform.value?.agent?.online) await load(true).catch(() => {})
    schedule()
  }, activeOps.value.length ? 3000 : 15000)
}

// ---------- 运维操作 ----------
const CONFIRM = {
  DEPLOY: row => `重新发布「${row.name}」：${row.source?.startsWith('git:') ? `拉取 ${row.branch || '跟踪分支'} 最新代码，` : ''}备份 → 构建 → 上线 → 健康检查，失败自动回滚。`,
  RESTART: row => `重启「${row.name}」的容器？正在使用的人会短暂断开。`,
  START: row => `启动「${row.name}」？`,
  STOP: row => `停用「${row.name}」？容器停止、入口关闭，代码、数据、数据库都保留，随时可以再启动。`,
  REMOVE: row => `移除「${row.name}」？容器、路由和控制台里的登记都会删除；代码、数据目录和数据库先备份到宿主机 backups/removed/ 下。`
}

async function op(row, kind) {
  if (kind !== 'LOGS') {
    try {
      if (kind === 'REMOVE') {
        await ElMessageBox.prompt(`${CONFIRM.REMOVE(row)}\n\n确认请输入应用 code：${row.code}`, '移除应用', {
          type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger',
          inputValidator: v => v === row.code || '输入的 code 不一致'
        })
      } else {
        await ElMessageBox.confirm(CONFIRM[kind](row), OP_KIND[kind], { type: kind === 'STOP' ? 'warning' : 'info', confirmButtonText: OP_KIND[kind], cancelButtonText: '取消' })
      }
    } catch {
      return
    }
  }
  const o = await platformApi.request(kind, row.code)
  showLog(o, row)
  load(true)
}

function showLog(o, app) {
  logDrawer.opId = o.id
  logDrawer.app = app
  logDrawer.visible = true
}
const logDrawer = reactive({ visible: false, opId: null, app: null })
function onOpDone() { load(true) }

// ---------- 安装 ----------
const instRef = ref(null)
const inst = reactive({ visible: false, saving: false, form: { git: '', code: '', branch: '' } })
const instRules = {
  git: [{ required: true, message: '请填写仓库地址', trigger: 'blur' }],
  code: [
    { required: true, message: '请填写应用 code', trigger: 'blur' },
    { pattern: /^[a-z][a-z0-9-]{1,30}$/, message: '小写字母开头，只含小写字母、数字、短横线（2~31 位）', trigger: 'blur' }
  ]
}
function openInstall() {
  inst.form = { git: '', code: '', branch: '' }
  inst.visible = true
}
// 仓库名自动带出 code（用户改过 code 就不再覆盖）
const repoName = g => (g.split(/[/:]/).pop() || '').replace(/\.git$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 31)
watch(() => inst.form.git, (g, prev) => {
  const guess = repoName(g || '')
  if ((!inst.form.code || inst.form.code === repoName(prev || '')) && /^[a-z]/.test(guess)) inst.form.code = guess
})
async function install() {
  try { await instRef.value.validate() } catch { return }
  inst.saving = true
  try {
    const o = await platformApi.request('INSTALL', inst.form.code, { git: inst.form.git.trim(), branch: inst.form.branch.trim() || undefined })
    inst.visible = false
    showLog(o, { code: inst.form.code, name: inst.form.code })
    load(true)
  } finally {
    inst.saving = false
  }
}

// ---------- 记录 ----------
const hist = reactive({ visible: false, loading: false, app: null, ops: [], deploys: [] })
async function openHistory(row) {
  Object.assign(hist, { visible: true, loading: true, app: row, ops: [], deploys: [] })
  try {
    const [ops, deploys] = await Promise.all([platformApi.ops({ appCode: row.code }), platformApi.deploys({ appCode: row.code })])
    hist.ops = ops || []
    hist.deploys = deploys || []
  } finally {
    hist.loading = false
  }
}

async function more(row, cmd) {
  if (cmd === 'edit') return openEdit(row)
  if (cmd === 'usage') return openUsage(row)
  if (cmd === 'history') return openHistory(row)
  if (cmd === 'open') return window.open(row.url, '_blank', 'noopener')
  if (cmd === 'secret') return resetSecret(row)
  if (cmd === 'delete') return removeRegistration(row)
  if (cmd === 'STOP' || cmd === 'REMOVE') return op(row, cmd)
}

// ---------- 设置 / 登记 ----------
const formRef = ref(null)
const dlg = reactive({ visible: false, id: null, managed: false, saving: false, form: {}, ownerInitial: [], visUserInitial: [], iconCustom: false, manifestIcon: null, manifestIconColor: null, iconReset: false, iconBefore: null })
const user = useUserStore()
const multiSpace = computed(() => !!user.me?.multiSpace)
const spaces = ref([])
const rules = {
  code: [{ required: true, message: '请填写编码', trigger: 'blur' }],
  name: [{ required: true, message: '请填写名称', trigger: 'blur' }],
  url: [{ required: true, message: '请填写地址', trigger: 'blur' }]
}

async function openEdit(row) {
  dlg.id = row?.id || null
  dlg.managed = !!row?.managed
  dlg.iconCustom = !!row?.iconCustom
  dlg.manifestIcon = row?.managed ? row.manifestIcon || '' : null
  dlg.manifestIconColor = row?.manifestIconColor || ''
  dlg.iconReset = false
  dlg.iconBefore = { icon: row?.icon || '', iconColor: row?.iconColor || '' }
  dlg.ownerInitial = row?.owner ? [row.owner] : []
  dlg.visUserInitial = []
  const v = row?.visibility
  dlg.form = {
    type: row?.type || 'SSO',
    code: row?.code || '',
    name: row?.name || '',
    icon: row?.icon || '',
    iconColor: row?.iconColor || '',
    category: row?.category || '',
    description: row?.description || '',
    url: row?.url || '',
    redirectUrisText: (row?.redirectUris || []).join('\n'),
    mcpUrl: row?.mcpUrl || '',
    visAll: !v,
    visDeptIds: v?.deptIds || [],
    visUserIds: v?.userIds || [],
    visRoles: v?.roles || [],
    isDefault: !!row?.isDefault,
    active: row ? row.status === 'ACTIVE' : true,
    sort: row?.sort || 0,
    llmDailyTokenLimit: row?.llmDailyTokenLimit ?? null,
    ownerId: row?.owner?.id ?? null,
    spaceId: row?.spaceId || user.me?.space?.id || 1,
    extraSpaceIds: row?.extraSpaceIds || []
  }
  if (multiSpace.value && !spaces.value.length) spaces.value = (await adminApi.spaces().catch(() => [])) || []
  dlg.visible = true
  // 指定用户回显姓名
  if (v?.userIds?.length) {
    const res = await orgApi.users({ pageSize: 100 }).catch(() => null)
    dlg.visUserInitial = (res?.list || []).filter(u => v.userIds.includes(u.id))
  }
}

async function save() {
  try { await formRef.value.validate() } catch { return }
  const f = dlg.form
  const payload = {
    visibility: f.visAll ? null : { deptIds: f.visDeptIds, userIds: f.visUserIds, roles: f.visRoles },
    isDefault: f.isDefault,
    sort: f.sort,
    llmDailyTokenLimit: f.llmDailyTokenLimit === null || f.llmDailyTokenLimit === '' ? null : Number(f.llmDailyTokenLimit),
    ownerId: f.ownerId || null,
    ...(multiSpace.value ? { spaceId: f.spaceId, extraSpaceIds: f.extraSpaceIds } : {})
  }
  if (dlg.managed) {
    // 代码应用：只有换了图标才发图标（发了就算自定义，之后发布不再覆盖）
    // 点了「恢复」之后又换了别的图标：按自定义算
    if (dlg.iconReset && f.icon === (dlg.manifestIcon || '') && f.iconColor === (dlg.manifestIconColor || '')) payload.iconReset = true
    else if (f.icon !== dlg.iconBefore.icon || f.iconColor !== dlg.iconBefore.iconColor) Object.assign(payload, { icon: f.icon, iconColor: f.iconColor })
  }
  if (!dlg.managed) {
    Object.assign(payload, {
      type: f.type, code: f.code, name: f.name, icon: f.icon, iconColor: f.iconColor, category: f.category, description: f.description, url: f.url,
      redirectUris: f.redirectUrisText.split('\n').map(s => s.trim()).filter(Boolean),
      mcpUrl: f.mcpUrl || null,
      status: f.active ? 'ACTIVE' : 'DISABLED'
    })
  }
  dlg.saving = true
  try {
    if (dlg.id) {
      await adminApi.updateApp(dlg.id, payload)
      ElMessage.success('已保存')
    } else {
      const res = await adminApi.createApp(payload)
      ElMessage.success('已登记')
      if (res?.clientSecret) showSecret(res)
    }
    dlg.visible = false
    load(true)
  } finally {
    dlg.saving = false
  }
}

/** 代码应用：预览恢复成 yh-app.json 里的图标，保存时才真正恢复 */
function resetIcon() {
  dlg.iconReset = true
  dlg.form.icon = dlg.manifestIcon || ''
  dlg.form.iconColor = dlg.manifestIconColor || ''
}

async function removeRegistration(row) {
  try {
    await ElMessageBox.confirm(`删除「${row.name}」的登记？用户的工作台上不再显示，它的统一认证凭证立即失效。`, '删除登记', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' })
  } catch {
    return
  }
  await adminApi.removeApp(row.id)
  ElMessage.success('已删除')
  load(true)
}

async function resetSecret(row) {
  try {
    await ElMessageBox.confirm(`重置「${row.name}」的 Client Secret？旧密钥立即失效，应用需要更新配置。`, '重置密钥', { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' })
  } catch {
    return
  }
  showSecret(await adminApi.resetSecret(row.id))
}

const secret = reactive({ visible: false, clientId: '', clientSecret: '' })
const discoveryUrl = `${window.location.origin}/.well-known/openid-configuration`
function showSecret(res) {
  secret.clientId = res.clientId || res.app?.clientId || ''
  secret.clientSecret = res.clientSecret
  secret.visible = true
}
async function copy(text) {
  if (await copyText(text)) ElMessage.success('已复制')
  else ElMessage.error('复制失败，请手动选择复制')
}

const usageDrawer = reactive({ visible: false, app: null })
function openUsage(app) {
  usageDrawer.app = app
  usageDrawer.visible = true
}

onMounted(() => {
  load().then(schedule)
  appStore.load()
  orgApi.departments().then(d => { depts.value = d || [] }).catch(() => {})
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<style scoped>
.managed-icon { display: flex; flex-direction: column; gap: 6px; }
.reset-tip { color: var(--yh-warning); }
.agent {
  display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 9px 12px; border-radius: 10px; margin-bottom: 14px;
  background: var(--yh-fill); border: 1px solid var(--yh-border-soft); flex-wrap: wrap;
}
.agent code { background: #eef2f7; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.agent-dot { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; }
.agent.on { background: #f0fdf4; border-color: #dcfce7; }
.agent.on .agent-dot { background: var(--yh-success); box-shadow: 0 0 0 3px rgba(22, 163, 74, .15); }
.agent.off { background: #fffbeb; border-color: #fef3c7; }
.agent.off .agent-dot { background: #f59e0b; }
.agent-run { color: var(--yh-warning); }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.small { font-size: 12px; }
.danger { color: var(--yh-danger); }
.run { gap: 6px; font-size: 13px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; flex-shrink: 0; }
.dot.ok { background: var(--yh-success); }
.dot.bad { background: var(--yh-danger); }
.dot.off { background: #cbd5e1; }
.dot.busy { background: var(--yh-warning); animation: blink 1s infinite; }
@keyframes blink { 50% { opacity: .3; } }
.app-ver { font-weight: 600; font-variant-numeric: tabular-nums; }
.ver { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: var(--yh-text-3); background: var(--yh-fill-2); padding: 0 5px; border-radius: 4px; }
.mount-tag { margin-top: 4px; cursor: pointer; }
.mount { display: flex; flex-direction: column; gap: 4px; padding: 10px; margin-bottom: 8px; background: var(--yh-fill); border-radius: 8px; font-size: 13px; }
.mount-path { word-break: break-all; }
.vis-box { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; padding: 10px; background: var(--yh-fill); border-radius: 8px; }
.sec-title { font-weight: 600; font-size: 14px; margin-bottom: 8px; }
.hist-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; font-size: 13px; }
.hist-row:hover { background: var(--yh-fill); }
.hist-row.static { cursor: default; }
.hist-row code { font-size: 12px; color: var(--yh-text-2); }
.cred { margin-top: 16px; }
.cred-label { font-size: 12px; color: var(--yh-text-3); margin: 12px 0 4px; }
.cred-hint { color: var(--yh-text-3); opacity: .8; margin-left: 4px; }
.cred-row { display: flex; align-items: center; gap: 8px; }
.cred-row code { flex: 1; background: var(--yh-fill-2); padding: 8px 10px; border-radius: 6px; font-size: 13px; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; user-select: all; }
</style>
