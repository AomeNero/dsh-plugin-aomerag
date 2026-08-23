// AomeRAG 设置页文案(浏览器半 locale 字典,zh/en 双语)。

export type AomeragKey =
  | 'nav'
  | 'intro'
  | 'field.chunkTarget'
  | 'field.chunkMax'
  | 'field.chunkOverlap'
  | 'field.topK'
  | 'field.rrfK'
  | 'field.embedBatchSize'
  | 'hint.chunk'
  | 'hint.search'
  | 'hint.batch'
  | 'deployNote'
  | 'ops.title'
  | 'ops.status'
  | 'ops.sync'
  | 'readonly'

export const zh: Record<AomeragKey, string> = {
  nav: 'AomeRAG 知识库',
  intro: '检索与切片的行为参数,保存后立即生效(下次检索/同步使用新值)。',
  'field.chunkTarget': '切片目标长度(字符)',
  'field.chunkMax': '切片最大长度(字符)',
  'field.chunkOverlap': '切片重叠(字符)',
  'field.topK': '检索命中数 top_k',
  'field.rrfK': 'RRF 融合常数 k',
  'field.embedBatchSize': 'embedding 批大小',
  'hint.chunk': '标题优先切分,超长段落按目标长度兜底,相邻窗口保留重叠。',
  'hint.search': 'kb_search 每次返回的命中片段数;调用时可临时覆盖。',
  'hint.batch': '每次请求 Ollama 的文本条数;过大可能压垮本机模型。',
  deployNote: '部署层配置(知识目录、库文件路径、Ollama 地址与模型、维度)在 cordis.yml 的 config 中,修改后需重启。',
  'ops.title': '状态与手动同步',
  'ops.status': '对 agent 说「查一下知识库状态」(kb_status)',
  'ops.sync': '对 agent 说「我更新了文档,重新导一下」(kb_ingest)',
  readonly: '当前浏览器为远程连接,设置只读(settings 仅回环可写)。',
}

export const en: Record<AomeragKey, string> = {
  nav: 'AomeRAG Knowledge',
  intro: 'Retrieval and chunking behavior. Saved values apply from the next search/sync.',
  'field.chunkTarget': 'Chunk target length (chars)',
  'field.chunkMax': 'Chunk max length (chars)',
  'field.chunkOverlap': 'Chunk overlap (chars)',
  'field.topK': 'Search top_k',
  'field.rrfK': 'RRF fusion constant k',
  'field.embedBatchSize': 'Embedding batch size',
  'hint.chunk': 'Heading-first split; oversized sections fall back to fixed windows with overlap.',
  'hint.search': 'Hits returned per kb_search call; overridable per call.',
  'hint.batch': 'Texts per Ollama request; too large may overload a local model.',
  deployNote: 'Deployment settings (knowledge dir, db path, Ollama URL/model, dim) live in cordis.yml config and need a restart.',
  'ops.title': 'Status & manual sync',
  'ops.status': 'Ask the agent: "check the knowledge base status" (kb_status)',
  'ops.sync': 'Ask the agent: "I updated the docs, re-ingest" (kb_ingest)',
  readonly: 'Remote browser: settings are read-only (settings writes are loopback-only).',
}
