// settings namespace 定义(方案 B 数据层 + 状态/命令通道):
//   aomerag        可调参数(表单;url/model/syncOnStart 热更新,mdDir/dbPath 保存后重启生效)
//   aomerag-status 状态快照(Host 在启动与每次同步结束后写入;快照式,非实时)
//   aomerag-command 命令通道(浏览器按钮写入 {action, nonce},Host watch 执行后清回)
// 代价说明:status/command 是借 settings wire 的数据通道,会在 ~/.dsh/settings.yaml
// 留下非配置语义的节(平台约束:第三方无 remote RPC,porting-notes #29)。

import z from '@deepseek-ai/schemastery'
import type { SyncReport } from './sync.ts'

// 0.1.6 起 settingsNamespace brand 助手已移除;ctx.settings.register 在运行时
// 校验命名空间形如 /^[a-z][a-z0-9-]*$/,以下三个常量均为普通字符串。
export const TUNABLE_NAMESPACE = 'aomerag'
export const STATUS_NAMESPACE = 'aomerag-status'
export const COMMAND_NAMESPACE = 'aomerag-command'

/** 可调参数集(默认值与 config.ts 对齐;数值字段进 web 表单) */
export interface AomeragTunable {
  chunkTarget: number
  chunkMax: number
  chunkOverlap: number
  topK: number
  rrfK: number
  embedBatchSize: number
  ollamaBaseUrl: string
  embedModel: string
  syncOnStart: boolean
  mdDir: string
  dbPath: string
}

/** 数值参数边界(单一带源:TunableSchema 钳制与 config.ts 严格校验都从这里取)。
 *  上限防巨串/巨请求(R24),下限 ≥1 防 0 值挂死/崩溃(R1/R2)。 */
export const LIMITS = {
  chunkTarget: [100, 65536],
  chunkMax: [200, 65536],
  chunkOverlap: [0, 65535],
  topK: [1, 100],
  rrfK: [1, 4096],
  embedBatchSize: [1, 1024],
} as const

/** 钳制转换型数值 schema:任何输入(0/负数/超大/字符串/null)收敛到 [min,max],
 *  永不抛出。settings 层专用——FileSettingsProvider 在 register 时同步 resolve 整个
 *  命名空间,拒绝型 schema 会被历史脏值炸掉注册(cordis 静默 logger 下不可见);
 *  钳制语义让老库自愈、新写入自动规范化。 */
const clampedInt = (min: number, max: number, def: number): z<number> =>
  z.transform(z.any(), (v) => {
    if (v == null) return def
    const n = Math.trunc(Number(v))
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def
  }).default(def) as z<number>

// 不注解 z<AomeragTunable>:z.object 自推导的调用入参是 Partial 形(ObjectS),
// 注解会把调用签名收紧为完整对象,测试/工具无法传部分字段。
export const TunableSchema = z.object({
  chunkTarget: clampedInt(...LIMITS.chunkTarget, 1200),
  chunkMax: clampedInt(...LIMITS.chunkMax, 1600),
  chunkOverlap: clampedInt(...LIMITS.chunkOverlap, 200),
  topK: clampedInt(...LIMITS.topK, 6),
  rrfK: clampedInt(...LIMITS.rrfK, 60),
  embedBatchSize: clampedInt(...LIMITS.embedBatchSize, 64),
  ollamaBaseUrl: z.string().default('http://127.0.0.1:11434'),
  embedModel: z.string().default('bge-m3'),
  syncOnStart: z.boolean().default(true),
  mdDir: z.string().default('./data/md'),
  dbPath: z.string().default('./data/aomerag.sqlite'),
})

/** 状态快照(六项核心 + 最近同步报告 + 库体积)。
 *  注意:schemastery 可选字段不接受 null——「未同步」用空串与空报告对象表示。 */
export interface AomeragStatus {
  docs: number
  chunks: number
  lastSyncAt: string
  syncing: boolean
  dbPath: string
  model: string
  lastReport: SyncReport
  dbSizeMB: number
}

export const emptyReport = (): SyncReport => ({
  added: 0,
  updated: 0,
  skipped: 0,
  removed: 0,
  failed: 0,
  errors: [],
})

export const ReportSchema: z<SyncReport> = z.object({
  added: z.natural().default(0),
  updated: z.natural().default(0),
  skipped: z.natural().default(0),
  removed: z.natural().default(0),
  failed: z.natural().default(0),
  errors: z.array(z.string()).default([]),
})

export const StatusSchema: z<AomeragStatus> = z.object({
  docs: z.natural().default(0),
  chunks: z.natural().default(0),
  lastSyncAt: z.string().default(''),
  syncing: z.boolean().default(false),
  dbPath: z.string().default(''),
  model: z.string().default(''),
  lastReport: ReportSchema.default(emptyReport()),
  dbSizeMB: z.number().default(0),
})

/** 命令通道(action='none' 为空闲;nonce 递增防重复触发) */
export type AomeragAction = 'none' | 'sync' | 'rebuild' | 'clear' | 'openDir'

export interface AomeragCommand {
  action: AomeragAction
  nonce: number
}

export const CommandSchema: z<AomeragCommand> = z.object({
  action: z.union(['none', 'sync', 'rebuild', 'clear', 'openDir'] as const).default('none'),
  nonce: z.natural().default(0),
})
