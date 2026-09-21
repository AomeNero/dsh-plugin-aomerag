// 插件配置(Schemastery):凡可调参数一律走 cordis.yml config,默认值对齐 AomeRAG。
// 数值边界严格拒绝(部署配置按 spec #21 加载期响亮失败);settings 用户层走钳制
// 转换自愈(tunable.ts clampedInt),两层语义不同、边界同源(LIMITS)。

import z from '@deepseek-ai/schemastery'
import { LIMITS } from './tunable.ts'

export const Config = z.object({
  /** 知识目录(.md 源文件;相对路径相对 dsh 工作目录) */
  mdDir: z.string().default('./data/md'),
  /** SQLite 库文件路径 */
  dbPath: z.string().default('./data/aomerag.sqlite'),
  ollamaBaseUrl: z.string().default('http://127.0.0.1:11434'),
  embedModel: z.string().default('bge-m3'),
  embedDim: z.natural().default(1024),
  chunkTarget: z.natural().min(LIMITS.chunkTarget[0]).max(LIMITS.chunkTarget[1]).default(1200),
  chunkMax: z.natural().min(LIMITS.chunkMax[0]).max(LIMITS.chunkMax[1]).default(1600),
  chunkOverlap: z.natural().min(LIMITS.chunkOverlap[0]).max(LIMITS.chunkOverlap[1]).default(200),
  topK: z.natural().min(LIMITS.topK[0]).max(LIMITS.topK[1]).default(6),
  rrfK: z.natural().min(LIMITS.rrfK[0]).max(LIMITS.rrfK[1]).default(60),
  embedBatchSize: z.natural().min(LIMITS.embedBatchSize[0]).max(LIMITS.embedBatchSize[1]).default(64),
  /** 插件启动时后台增量同步 */
  syncOnStart: z.boolean().default(true),
})
