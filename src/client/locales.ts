// AomeRAG 设置页文案(浏览器半 locale 字典,zh/en 双语)。

export type AomeragKey =
  | 'nav'
  | 'intro'
  | 'field.chunkTarget' | 'field.chunkMax' | 'field.chunkOverlap'
  | 'field.topK' | 'field.rrfK' | 'field.embedBatchSize'
  | 'field.ollamaBaseUrl' | 'field.embedModel' | 'field.syncOnStart'
  | 'hint.chunk' | 'hint.search' | 'hint.batch' | 'hint.ollama' | 'hint.model'
  | 'hint.syncOnStart'
  | 'status.title' | 'status.docs' | 'status.chunks' | 'status.lastSyncAt'
  | 'status.mdDir' | 'status.dbPath' | 'status.model' | 'status.dbSize' | 'status.never'
  | 'status.syncing' | 'status.idle'
  | 'report.title' | 'report.added' | 'report.updated' | 'report.skipped'
  | 'report.removed' | 'report.failed' | 'report.errors'
  | 'btn.title' | 'btn.sync' | 'btn.rebuild' | 'btn.clear' | 'btn.openDir'
  | 'btn.confirmRebuild' | 'btn.confirmClear' | 'btn.busy'
  | 'readonly' | 'loading'

export const zh: Record<AomeragKey, string> = {
  nav: 'AomeRAG 知识库',
  intro: '检索与切片的行为参数,保存后立即生效(下次检索/同步使用新值)。知识目录与库路径是部署字段,请改 cordis.yml 配置。',
  'field.chunkTarget': '切片目标长度(字符)',
  'field.chunkMax': '切片最大长度(字符)',
  'field.chunkOverlap': '切片重叠(字符)',
  'field.topK': '检索命中数 top_k',
  'field.rrfK': 'RRF 融合常数 k',
  'field.embedBatchSize': 'embedding 批大小',
  'field.ollamaBaseUrl': 'Ollama 地址',
  'field.embedModel': 'embedding 模型',
  'field.syncOnStart': '启动时自动同步',
  'hint.chunk': '标题优先切分,超长段落按目标长度兜底,相邻窗口保留重叠。',
  'hint.search': 'kb_search 每次返回的命中片段数;调用时可临时覆盖。',
  'hint.batch': '每次请求 Ollama 的文本条数;过大可能压垮本机模型。',
  'hint.ollama': '立即生效(重建客户端)。',
  'hint.model': '立即生效;换模型后请执行「重建索引」(向量空间不同)。',
  'hint.syncOnStart': '插件启动时后台增量同步(下次启动生效)。',
  'status.title': '库状态',
  'status.docs': '文档数',
  'status.chunks': 'chunk 数',
  'status.lastSyncAt': '最后同步',
  'status.mdDir': '知识目录',
  'status.dbPath': '库文件',
  'status.model': '模型',
  'status.dbSize': '库体积',
  'status.never': '(尚未同步)',
  'status.syncing': '同步中…',
  'status.idle': '空闲',
  'report.title': '最近同步报告',
  'report.added': '新增',
  'report.updated': '更新',
  'report.skipped': '跳过',
  'report.removed': '删除',
  'report.failed': '失败',
  'report.errors': '失败明细',
  'btn.title': '操作',
  'btn.sync': '立即同步',
  'btn.rebuild': '重建索引',
  'btn.clear': '清空库',
  'btn.openDir': '打开知识目录',
  'btn.confirmRebuild': '确认重建?(全量重切重嵌,大库耗时)',
  'btn.confirmClear': '确认清空?(删除全部已入库数据)',
  'btn.busy': '执行中…',
  readonly: '当前浏览器为远程连接,设置只读(settings 仅回环可写)。',
  loading: '读取中…',
}

export const en: Record<AomeragKey, string> = {
  nav: 'AomeRAG Knowledge',
  intro: 'Retrieval and chunking behavior. Saved values apply from the next search/sync. Knowledge dir and DB path are deployment fields — edit cordis.yml config instead.',
  'field.chunkTarget': 'Chunk target length (chars)',
  'field.chunkMax': 'Chunk max length (chars)',
  'field.chunkOverlap': 'Chunk overlap (chars)',
  'field.topK': 'Search top_k',
  'field.rrfK': 'RRF fusion constant k',
  'field.embedBatchSize': 'Embedding batch size',
  'field.ollamaBaseUrl': 'Ollama URL',
  'field.embedModel': 'Embedding model',
  'field.syncOnStart': 'Sync on start',
  'hint.chunk': 'Heading-first split; oversized sections fall back to fixed windows with overlap.',
  'hint.search': 'Hits returned per kb_search call; overridable per call.',
  'hint.batch': 'Texts per Ollama request; too large may overload a local model.',
  'hint.ollama': 'Applies immediately (client rebuilt).',
  'hint.model': 'Applies immediately; run "Rebuild index" after switching (different vector space).',
  'hint.syncOnStart': 'Background incremental sync when the plugin starts (takes effect next start).',
  'status.title': 'Library status',
  'status.docs': 'Docs',
  'status.chunks': 'Chunks',
  'status.lastSyncAt': 'Last sync',
  'status.mdDir': 'Knowledge dir',
  'status.dbPath': 'DB file',
  'status.model': 'Model',
  'status.dbSize': 'Size',
  'status.never': '(never)',
  'status.syncing': 'Syncing…',
  'status.idle': 'Idle',
  'report.title': 'Last sync report',
  'report.added': 'added',
  'report.updated': 'updated',
  'report.skipped': 'skipped',
  'report.removed': 'removed',
  'report.failed': 'failed',
  'report.errors': 'Failures',
  'btn.title': 'Actions',
  'btn.sync': 'Sync now',
  'btn.rebuild': 'Rebuild index',
  'btn.clear': 'Clear library',
  'btn.openDir': 'Open knowledge dir',
  'btn.confirmRebuild': 'Confirm rebuild? (full re-chunk & re-embed; slow on large libraries)',
  'btn.confirmClear': 'Confirm clear? (deletes all indexed data)',
  'btn.busy': 'Working…',
  readonly: 'Remote browser: settings are read-only (settings writes are loopback-only).',
  loading: 'Loading…',
}
