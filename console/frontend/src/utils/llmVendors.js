// 常用大模型厂商：选中后自动填 Base URL 和建议模型名（都可改）；仅前端辅助，不存库
// 「模型与 AI」的新增对话框和开通向导的「大模型」一步共用
export const VENDORS = [
  { id: 'qwen', label: '阿里百炼 · 通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', name: '通义千问', models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'], embModels: ['text-embedding-v3', 'text-embedding-v2'], keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', name: 'DeepSeek', models: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'], keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'moonshot', label: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', name: 'Kimi', models: ['kimi-k2-0711-preview', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'], keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', name: '智谱 GLM', models: ['glm-4.5', 'glm-4.6', 'glm-4-air', 'glm-4-flash'], embModels: ['embedding-3'], keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'], embModels: ['text-embedding-3-small'], keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', name: '硅基流动', models: ['deepseek-ai/DeepSeek-V3.1', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct', 'THUDM/glm-4-9b-chat'], embModels: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5'], keyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'ark', label: '火山方舟 · 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', name: '豆包', models: ['doubao-seed-1.6', 'doubao-1.5-pro-32k', 'doubao-pro-32k'], keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' },
  { id: 'hunyuan', label: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', name: '腾讯混元', models: ['hunyuan-turbos-latest', 'hunyuan-large', 'hunyuan-t1-latest'] },
  { id: 'ollama', label: 'Ollama（本机）', baseUrl: 'http://localhost:11434/v1', name: '本地模型', models: ['qwen3:8b', 'deepseek-r1:7b', 'llama3.1:8b'], embModels: ['nomic-embed-text', 'bge-m3'] },
  { id: 'custom', label: '自定义 / 其他', baseUrl: '', name: '', models: [] }
]

export const vendorByBaseUrl = url => VENDORS.find(v => v.baseUrl && v.baseUrl === url)?.id || 'custom'
