// 可调参数的 settings namespace 定义(方案 B 的数据层):
// Host 半经 ctx.settings.register 注册(schema + cordis config 作 base 层),
// 浏览器半表单经 settingsScope wire 读写——用户层覆盖存于 ~/.dsh/settings.yaml。
// 部署层配置(mdDir/dbPath/embedModel/ollamaBaseUrl/embedDim/syncOnStart)不进表单,留 cordis.yml。

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** dsh settings namespace 标识(branded,经 settingsNamespace() 构造) */
export const TUNABLE_NAMESPACE = settingsNamespace('aomerag')

/** 可调参数集(全部数值,热更新无需重启;默认值与 config.ts 对齐 AomeRAG) */
export interface AomeragTunable {
  chunkTarget: number
  chunkMax: number
  chunkOverlap: number
  topK: number
  rrfK: number
  embedBatchSize: number
}

export const TunableSchema: z<AomeragTunable> = z.object({
  chunkTarget: z.natural().default(1200),
  chunkMax: z.natural().default(1600),
  chunkOverlap: z.natural().default(200),
  topK: z.natural().min(1).default(6),
  rrfK: z.natural().default(60),
  embedBatchSize: z.natural().default(64),
})
