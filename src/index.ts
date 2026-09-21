// 插件入口:装配 store/embedder/sync/retriever,注册三工具,触发启动同步。
// settings 体系(方案 B):参数 namespace(热更新)+ 状态快照 namespace + 命令通道 namespace
// (浏览器半表单/状态/按钮的全部数据面;平台约束与代价见 src/tunable.ts 头注)。
// mdDir/dbPath 属部署字段:apply 启动时锁定快照(boot),表单改动重启生效。

import { spawn } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, parse, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { Config } from './config.ts'
import { KbStore } from './store.ts'
import { Embedder } from './embedder.ts'
import { syncDir } from './sync.ts'
import type { SyncReport, EmbedsTexts } from './sync.ts'
import { hybridSearch } from './retriever.ts'
import { createKbTools } from './tools.ts'
import type { KbCore } from './tools.ts'
import {
  TUNABLE_NAMESPACE, STATUS_NAMESPACE, COMMAND_NAMESPACE,
  TunableSchema, StatusSchema, CommandSchema,
  emptyReport, LIMITS,
} from './tunable.ts'
import type { AomeragTunable } from './tunable.ts'

export const name = 'dsh-aomerag'
export const inject = ['tools']
export { Config }

export type PluginConfig = ReturnType<typeof Config>

const getErrorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const lanceDirOf = (dbPath: string): string => {
  const p = parse(dbPath)
  return join(p.dir, `${p.name}.lance`)
}

/** 库体积(SQLite 文件 + Lance 目录,MB;目录递归求和) */
const dbSizeMB = (dbPath: string): number => {
  let bytes = 0
  try {
    bytes += statSync(dbPath).size
  } catch {
    /* 库文件尚不存在 */
  }
  try {
    for (const entry of readdirSync(lanceDirOf(dbPath), { withFileTypes: true })) {
      if (entry.isFile()) {
        try {
          bytes += statSync(join(lanceDirOf(dbPath), entry.name)).size
        } catch {
          /* 单文件缺失跳过 */
        }
      }
    }
  } catch {
    /* lance 目录尚不存在 */
  }
  return Math.round((bytes / 1e6) * 10) / 10
}

export function apply(ctx: Context, config: Partial<PluginConfig> = {}): void {
  const cfg = Config(config)

  // 可调参数:cordis 层为 base;settings 服务就绪后注册 namespace,用户层覆盖热更新。
  const runtime: AomeragTunable = {
    chunkTarget: cfg.chunkTarget,
    chunkMax: cfg.chunkMax,
    chunkOverlap: cfg.chunkOverlap,
    topK: cfg.topK,
    rrfK: cfg.rrfK,
    embedBatchSize: cfg.embedBatchSize,
    ollamaBaseUrl: cfg.ollamaBaseUrl,
    embedModel: cfg.embedModel,
    syncOnStart: cfg.syncOnStart,
    mdDir: cfg.mdDir,
    dbPath: cfg.dbPath,
  }

  // 部署字段启动快照(cordis 层;表单改动重启生效——见下方 settings 块的时序说明)
  const boot = { dbPath: cfg.dbPath, mdDir: cfg.mdDir, syncOnStart: cfg.syncOnStart }

  const store = KbStore.open(boot.dbPath, { dim: cfg.embedDim })

  // Embedder 热更:url/model 变化时重建(指纹缓存);对 sync/retriever 暴露稳定代理
  let embFingerprint = ''
  let embInstance: Embedder | undefined
  const getEmbedder = (): Embedder => {
    const fp = `${runtime.ollamaBaseUrl}|${runtime.embedModel}`
    if (embInstance === undefined || fp !== embFingerprint) {
      embInstance = new Embedder({
        baseUrl: runtime.ollamaBaseUrl,
        model: runtime.embedModel,
        dim: cfg.embedDim,
      })
      embFingerprint = fp
    }
    return embInstance
  }
  const embedProxy: EmbedsTexts = { embed: (texts) => getEmbedder().embed(texts) }

  const state = { syncing: false, lastSyncAt: '', lastReport: emptyReport() }

  // 状态快照 namespace(快照式:启动与每次同步开始/结束写;浏览器 watch 自动刷新)
  const publishStatus = (): void => {
    if (!statusScope) return
    const counts = store.docCount()
    void statusScope
      .update({
        docs: counts.docs,
        chunks: counts.chunks,
        lastSyncAt: state.lastSyncAt,
        syncing: state.syncing,
        dbPath: boot.dbPath,
        model: runtime.embedModel,
        lastReport: state.lastReport,
        dbSizeMB: dbSizeMB(boot.dbPath),
      })
      .catch((e: unknown) => ctx.logger.warn(`dsh-aomerag 状态快照写入失败:${getErrorMessage(e)}`))
  }
  let statusScope: ReturnType<Context['settings']['register']> | undefined

  const runSync = async (dir: string, force = false): Promise<SyncReport> => {
    // 单飞互斥(审查 R6):kb_ingest / boot sync / 命令三入口统一被闸。
    // upsertDoc 在「SQLite 事务提交 → await Lance 写入」之间存在 await 点,两个
    // syncDir 交错会产生 Lance 孤儿、rebuild 与 boot sync 交错则静默 no-op。
    // syncing 在首个 await 前同步置位,事件循环内无竞态。
    if (state.syncing) throw new Error('已有同步任务在进行中,请等待完成后再试')
    state.syncing = true
    publishStatus()
    try {
      const report = await syncDir({ store, embedder: embedProxy }, dir, {
        target: runtime.chunkTarget,
        max: runtime.chunkMax,
        overlap: runtime.chunkOverlap,
        batchSize: runtime.embedBatchSize,
        force,
      })
      state.lastSyncAt = new Date().toISOString()
      state.lastReport = report
      return report
    } finally {
      state.syncing = false
      publishStatus()
    }
  }

  const core: KbCore = {
    async search(query, topK) {
      // top_k 是 LLM 直传的调用参数(不在 schema 闸内):负值曾穿透为 SQLite 无限制
      // LIMIT,超大值曾击穿 chunkMeta 占位符上限(R13),入口钳制收口。
      const k = Math.min(
        Math.max(Math.trunc(topK ?? runtime.topK), LIMITS.topK[0]),
        LIMITS.topK[1],
      )
      const hits = await hybridSearch({ store, embedder: embedProxy }, query, k, runtime.rrfK)
      return {
        hits,
        status: state.syncing ? 'syncing' : hits.length === 0 ? 'empty' : 'ok',
      }
    },
    ingest(dir) {
      const target = dir ?? boot.mdDir
      // 库与目录一一对应:syncDir 的清理语义以本次扫描集为基准,对第二个目录
      // ingest = 用该目录替换整库(审查 R3——幻觉/误传/注入驱动的整库清空链)。
      const norm = (p: string): string => {
        const r = resolve(p)
        return process.platform === 'win32' ? r.toLowerCase() : r
      }
      if (norm(target) !== norm(boot.mdDir)) {
        throw new Error(
          `kb_ingest 仅支持配置的知识目录(${boot.mdDir}),收到:${dir}。库与目录一一对应,切换目录请修改配置后重启。`,
        )
      }
      return runSync(target)
    },
    status() {
      const counts = store.docCount()
      return {
        docs: counts.docs,
        chunks: counts.chunks,
        lastSyncAt: state.lastSyncAt,
        syncing: state.syncing,
        dbPath: boot.dbPath,
        model: runtime.embedModel,
      }
    },
  }

  for (const tool of Object.values(createKbTools(core))) {
    ctx.tools.register(tool)
  }

  // settings 注册(参数 namespace + 状态快照 + 命令通道):**声明式注入**——服务就绪即触发。
  // 不可用动态 ctx.get:provider(FileSettingsProvider)有异步 init,publish 前服务尚不可
  // injectable,apply 时动态读会拿到 undefined 静默跳过注册(浏览器侧三 scope 全 unavailable
  // 的根因)。ctx.inject 缺服务时静默不触发,恰好是可选依赖语义。
  ctx.inject(['settings'], (sctx) => {
    const settingsSvc = sctx.settings
    const tunableScope = settingsSvc.register(TUNABLE_NAMESPACE, TunableSchema, { base: { ...runtime } })
    Object.assign(runtime, tunableScope.get())
    tunableScope.watch(() => {
      Object.assign(runtime, tunableScope.get())
    })

    statusScope = settingsSvc.register(STATUS_NAMESPACE, StatusSchema, {
      base: {
        docs: 0, chunks: 0, lastSyncAt: '', syncing: false,
        dbPath: boot.dbPath, model: runtime.embedModel, lastReport: emptyReport(), dbSizeMB: 0,
      },
    })
    const commandScope = settingsSvc.register(COMMAND_NAMESPACE, CommandSchema, {
      base: { action: 'none', nonce: 0 },
    })
    // 崩溃残留复位(审查 R17):命令执行中退出 → settings.yaml 残留 action,重启后
    // watch 不触发(注册不 commit)、无启动复位路径 → 按钮 busy 恒真永久锁死。
    // 挂 watch 前复位,残留 nonce 记为已消费防重放。
    let lastNonce = 0
    const staleCmd = commandScope.get()
    if (staleCmd.action !== 'none') {
      ctx.logger.warn(`dsh-aomerag 发现上次未完成的命令 ${staleCmd.action},已复位(残留即丢弃)`)
      lastNonce = staleCmd.nonce
      void commandScope.update({ action: 'none', nonce: staleCmd.nonce }).catch(() => undefined)
    }
    let commandBusy = false
    commandScope.watch(() => {
      const cmd = commandScope.get()
      if (cmd.action === 'none' || cmd.nonce === lastNonce) return
      lastNonce = cmd.nonce
      // busy 响亮拒绝 + 即时回清(审查 R16):旧实现静默吞(消费后丢弃无反馈),
      // 且 finally 用旧 nonce 回卷会覆盖执行期间浏览器写入的新命令。openDir 只读豁免。
      if (cmd.action !== 'openDir' && (commandBusy || state.syncing)) {
        ctx.logger.warn(`dsh-aomerag 命令 ${cmd.action} 被拒绝:同步任务进行中`)
        void commandScope.update({ action: 'none', nonce: cmd.nonce }).catch(() => undefined)
        return
      }
      commandBusy = true
      void (async () => {
        try {
          if (cmd.action === 'sync') {
            await runSync(boot.mdDir)
          } else if (cmd.action === 'rebuild') {
            // force 绕过 sha 短路全量重切重嵌;登记行保留 → 已删文件被清理循环
            // 覆盖(旧 prune([]) 写法使已删文件的 chunk 永久残留,审查 R4)
            await runSync(boot.mdDir, true)
          } else if (cmd.action === 'clear') {
            for (const docId of store.fileRegistry.keys()) await store.deleteDoc(docId)
            store.fileRegistry.prune([])
            state.lastSyncAt = ''
            state.lastReport = emptyReport()
            publishStatus()
          } else if (cmd.action === 'openDir') {
            const dir = boot.mdDir
            if (process.platform === 'win32') spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref()
            else if (process.platform === 'darwin') spawn('open', [dir], { detached: true, stdio: 'ignore' }).unref()
            else spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref()
          }
        } catch (e) {
          ctx.logger.warn(`dsh-aomerag 命令 ${cmd.action} 执行失败:${getErrorMessage(e)}`)
        } finally {
          commandBusy = false
          // 回清读当前 nonce:不复卷执行期间的旧值(防覆盖浏览器中途写入的新命令)
          void commandScope
            .update({ action: 'none', nonce: commandScope.get().nonce })
            .catch(() => undefined)
        }
      })()
    })
    publishStatus() // 启动快照
  })

  // 启动后台增量同步:不阻塞 apply 返回;失败告警不炸插件(下次 kb_ingest 可重试)
  if (boot.syncOnStart) {
    void runSync(boot.mdDir).catch((e: unknown) => {
      ctx.logger.warn(`dsh-aomerag 启动同步失败:${getErrorMessage(e)}`)
    })
  }

  // 卸载/HMR 清理:关库。注意 effect 的函数体立即执行、返回值才是清理器——
  // 必须返回关库函数而非在函数体内调用。若后台同步仍在写,其写库将失败并计入该次报告 failed。
  ctx.effect(() => () => store.close())
}
