// 插件入口:装配 store/embedder/sync/retriever,注册三工具,触发启动同步。
// 契约:docs/plan.md §2;启动同步后台跑(不阻塞插件就绪),同步期间 kb_search 可查已入库部分。

import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.ts'
import { KbStore } from './store.ts'
import { Embedder } from './embedder.ts'
import { syncDir } from './sync.ts'
import type { SyncReport } from './sync.ts'
import { hybridSearch } from './retriever.ts'
import { createKbTools } from './tools.ts'
import type { KbCore } from './tools.ts'

export const name = 'dsh-aomerag'
export const inject = ['tools']
export { Config }

export type PluginConfig = ReturnType<typeof Config>

const getErrorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function apply(ctx: Context, config: Partial<PluginConfig> = {}): void {
  const cfg = Config(config)

  const store = KbStore.open(cfg.dbPath, { dim: cfg.embedDim })
  const embedder = new Embedder({
    baseUrl: cfg.ollamaBaseUrl,
    model: cfg.embedModel,
    dim: cfg.embedDim,
  })
  const state = { syncing: false, lastSyncAt: null as string | null }

  const runSync = async (dir: string): Promise<SyncReport> => {
    state.syncing = true
    try {
      const report = await syncDir({ store, embedder }, dir, {
        target: cfg.chunkTarget,
        max: cfg.chunkMax,
        overlap: cfg.chunkOverlap,
        batchSize: cfg.embedBatchSize,
      })
      state.lastSyncAt = new Date().toISOString()
      return report
    } finally {
      state.syncing = false
    }
  }

  const core: KbCore = {
    async search(query, topK) {
      const hits = await hybridSearch({ store, embedder }, query, topK ?? cfg.topK, cfg.rrfK)
      return {
        hits,
        status: state.syncing ? 'syncing' : hits.length === 0 ? 'empty' : 'ok',
      }
    },
    ingest(dir) {
      return runSync(dir ?? cfg.mdDir)
    },
    status() {
      const counts = store.docCount()
      return {
        docs: counts.docs,
        chunks: counts.chunks,
        lastSyncAt: state.lastSyncAt,
        syncing: state.syncing,
        dbPath: cfg.dbPath,
        model: cfg.embedModel,
      }
    },
  }

  for (const tool of Object.values(createKbTools(core))) {
    ctx.tools.register(tool)
  }

  // 启动后台增量同步:不阻塞 apply 返回;失败告警不炸插件(下次 kb_ingest 可重试)
  if (cfg.syncOnStart) {
    void runSync(cfg.mdDir).catch((e: unknown) => {
      ctx.logger.warn(`dsh-aomerag 启动同步失败:${getErrorMessage(e)}`)
    })
  }

  // 卸载/HMR 清理:关库。注意 effect 的函数体立即执行、返回值才是清理器——
  // 必须返回关库函数而非在函数体内调用。若后台同步仍在写,其写库将失败并计入该次报告 failed。
  ctx.effect(() => () => store.close())
}
