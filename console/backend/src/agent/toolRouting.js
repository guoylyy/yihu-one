// 工具太多时的分流（内置 AI 助手用；MCP 接口照常给全量，Claude Code 等客户端自己会处理）
//
// 模型一次能接的工具有上限（OpenAI 兼容接口一般 128 个），工具多了模型也更容易选错。
// 平台自带的工具、工具少的应用直接给模型；放不下的应用不逐个列出，改给两个路由工具：
//   find_app_tools(query, app?)   按关键词查这些应用的工具，返回工具名、说明、参数
//   call_app_tool(name, arguments) 调用查到的工具 —— runner 执行前把它换成真实的工具（resolveCall），
//                                  写操作照样弹确认卡片、记审计，和直接调用完全一样
export const DIRECT_LIMIT = 60
export const FIND = 'find_app_tools'
export const CALL = 'call_app_tool'

/** tools → { direct: 给模型的工具（含路由工具）, routed: 不直接给、要经路由工具调用的应用工具 } */
export function routeTools(tools, limit = DIRECT_LIMIT) {
  if (tools.length <= limit) return { direct: tools, routed: [] }
  const own = tools.filter(t => !t.appCode)
  const byApp = new Map()
  for (const t of tools) if (t.appCode) byApp.set(t.appCode, [...(byApp.get(t.appCode) || []), t])
  const direct = [...own]
  const routed = []
  let budget = limit - own.length - 2
  // 工具少的应用优先直接给：它们一般是专门做一两件事的，直接列出来最容易被用上
  for (const list of [...byApp.values()].sort((a, b) => a.length - b.length)) {
    if (list.length <= budget) { direct.push(...list); budget -= list.length } else routed.push(...list)
  }
  if (routed.length) direct.push(findTool(routed), callTool(routed))
  return { direct, routed }
}

/** call_app_tool 的调用 → 真实工具和参数；找不到返回 { error } */
export function resolveCall(routed, args) {
  const name = String(args?.name || '')
  const tool = routed.find(t => t.name === name)
  if (!tool) return { error: `没有工具 ${name || '（未填写）'}：先用 ${FIND} 按关键词查到工具名再调用` }
  const a = args?.arguments
  return { tool, args: a && typeof a === 'object' && !Array.isArray(a) ? a : {} }
}

/** 关键词打分：按空格 / 标点切词，中文再按两个字切，命中工具名、标题、说明越多分越高 */
export function searchTools(routed, { query = '', app = '' } = {}, limit = 8) {
  const appQ = String(app || '').trim().toLowerCase()
  const pool = appQ ? routed.filter(t => t.appCode.toLowerCase() === appQ || String(t.appName || '').toLowerCase().includes(appQ)) : routed
  const q = String(query || '').toLowerCase().trim()
  const words = q.split(/[\s,，、。;；:：/|]+/).filter(Boolean)
  const terms = new Set(words)
  for (const w of words) if (/[一-鿿]/.test(w) && w.length > 2) for (let i = 0; i < w.length - 1; i++) terms.add(w.slice(i, i + 2))
  const scored = pool.map(t => {
    const hay = `${t.name} ${t.label} ${t.description}`.toLowerCase()
    let score = 0
    for (const term of terms) if (hay.includes(term)) score += term.length > 1 ? term.length : 0.5
    return { t, score }
  })
  const hits = q ? scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score) : scored
  const describe = (t) => ({ name: t.name, app: t.appName, description: String(t.description || '').replace(/^\[应用：[^\]]*\]\s*/, '').slice(0, 300), write: !!t.write })
  if (!hits.length) {
    // 一个都没对上：给出这些工具的名字和一句话说明，让模型换个词或直接挑
    return { matches: [], hint: '没有匹配的工具，下面是可用工具清单，挑一个再用 find_app_tools 查它的参数', tools: pool.slice(0, 60).map(t => ({ name: t.name, app: t.appName, description: String(t.description || '').replace(/^\[应用：[^\]]*\]\s*/, '').slice(0, 60) })) }
  }
  return {
    matches: hits.slice(0, limit).map(({ t }) => ({ ...describe(t), parameters: t.jsonSchema || { type: 'object', properties: {} } })),
    more: Math.max(0, hits.length - limit)
  }
}

function appNames(routed) {
  return [...new Set(routed.map(t => `${t.appName}（${t.appCode}）`))].join('、')
}

function findTool(routed) {
  return {
    name: FIND,
    label: '查应用的工具',
    description: `这些应用的工具没有直接列出：${appNames(routed)}。要用它们做事时，先用本工具按关键词查（如「工时」「创建任务」「项目进度」），返回工具名、说明和参数，再用 ${CALL} 调用。`,
    jsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要做的事的关键词，几个词用空格隔开' },
        app: { type: 'string', description: '只查某个应用：应用 code 或名称，可不填' }
      },
      required: ['query']
    },
    write: false,
    confirm: false,
    run: async (ctx, a) => searchTools(routed, a)
  }
}

function callTool(routed) {
  return {
    name: CALL,
    label: '调用应用的工具',
    description: `调用用 ${FIND} 查到的工具：name 填查到的工具名，arguments 按它的 parameters 填。写操作会照常让用户确认。`,
    jsonSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: `${FIND} 返回的工具名` },
        arguments: { type: 'object', description: '工具参数' }
      },
      required: ['name']
    },
    write: false,
    confirm: false,
    // 正常不会走到这里：runner 执行前已经用 resolveCall 换成真实工具
    run: async () => { throw new Error(`请通过 ${FIND} 查到工具后再调用`) },
    routedApps: appNames(routed)
  }
}
