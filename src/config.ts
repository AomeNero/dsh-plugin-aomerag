// 插件配置(Schemastery):凡可调参数一律走 cordis.yml config,默认值对齐 AomeRAG。

import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  /** 知识目录(.md 源文件;相对路径相对 dsh 工作目录) */
  mdDir: z.string().default('./data/md'),
  /** SQLite 库文件路径 */
  dbPath: z.string().default('./data/aomerag.sqlite'),
  ollamaBaseUrl: z.string().default('http://127.0.0.1:11434'),
  embedModel: z.string().default('bge-m3'),
  embedDim: z.natural().default(1024),
  chunkTarget: z.natural().default(1200),
  chunkMax: z.natural().default(1600),
  chunkOverlap: z.natural().default(200),
  topK: z.natural().min(1).default(6),
  rrfK: z.natural().default(60),
  embedBatchSize: z.natural().default(64),
  /** 插件启动时后台增量同步 */
  syncOnStart: z.boolean().default(true),
})
