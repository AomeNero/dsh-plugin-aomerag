// P7 端到端验收:AomeRAG 真实语料(raw/md-data,1155 个 md)全量入库 + 增量验证 + 检索质量抽查。
// 运行:cd spike/acceptance && node D:\GitHub\deepseek-harness\vendor\cordis\bin.js
import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

export const name = 'aome-acceptance'
export const inject = ['tools']

export function apply(ctx: Context) {
  void (async () => {
    // 等待 dsh-aomerag 插件注册工具(cordis.yml 行序之后的加载)
    for (let i = 0; i < 100 && ctx.tools.get('kb_ingest') === undefined; i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    if (ctx.tools.get('kb_ingest') === undefined) throw new Error('kb_ingest 未注册(dsh-aomerag 加载失败?)')

    let n = 0
    const exec = <T>(name: string, args: Record<string, unknown> = {}): Promise<T> =>
      ctx.tools.execute({
        callId: ToolCallId(`acc-${++n}`),
        name,
        arguments: args,
        signal: new AbortController().signal,
      }) as Promise<T>

    type Report = { added: number; updated: number; skipped: number; removed: number; failed: number; errors: string[] }
    type Status = { docs: number; chunks: number; lastSyncAt: string | null; syncing: boolean }
    type Search = { hits: Array<{ sourceDoc: string; headingPath: string; score: number; content: string }>; status: string }

    console.log('=== [1] 全量首灌(真 Ollama bge-m3)===')
    const t0 = performance.now()
    const r1 = await exec<{ isError: boolean; value?: Report; error?: { message: string } }>('kb_ingest', {})
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
    if (r1.isError || !r1.value) throw new Error(`首灌失败: ${r1.error?.message}`)
    console.log(`首灌完成 ${elapsed}s:`, JSON.stringify(r1.value))
    if (r1.value.failed > 0) {
      console.log('失败明细(前 5):', r1.value.errors.slice(0, 5))
    }

    const st = await exec<{ isError: boolean; value: Status }>('kb_status', {})
    console.log('=== [2] kb_status ===', JSON.stringify(st.value))

    console.log('=== [3] 二次同步(应全 skipped)===')
    const t1 = performance.now()
    const r2 = await exec<{ isError: boolean; value?: Report; error?: { message: string } }>('kb_ingest', {})
    console.log(
      `二次同步 ${((performance.now() - t1) / 1000).toFixed(1)}s:`,
      JSON.stringify(r2.value ?? r2.error),
    )

    console.log('=== [4] 检索质量抽查 ===')
    const queries = [
      'PG361 电源管理 限流告警',
      'MIPI Lane 配置 初始化',
      '老化炉操作 SOP',
      'Lua 字符串处理 表格操作',
      'GPIO PWM 频率测量',
    ]
    let pass = 0
    for (const q of queries) {
      const r = await exec<{ isError: boolean; value?: Search; error?: { message: string } }>('kb_search', { query: q, top_k: 3 })
      if (r.isError || !r.value) {
        console.log(`❌ "${q}" 检索失败: ${r.error?.message}`)
        continue
      }
      const top = r.value.hits[0]
      if (top) {
        pass++
        console.log(`✅ "${q}" → ${top.sourceDoc} > ${top.headingPath} (score ${top.score.toFixed(4)})`)
        console.log(`   ${top.content.replace(/\n+/g, ' ').slice(0, 90)}`)
      } else {
        console.log(`⚠️ "${q}" → 0 命中 (status=${r.value.status})`)
      }
    }
    console.log(`\n抽查 ${pass}/${queries.length} 组首命中`)

    const ingested = r1.value.added > 1000 || r1.value.skipped === 1155 // 空库首灌 或 已灌库全 skipped(迁移场景)
    const ok = ingested && st.value && st.value.chunks > 1000 && r2.value?.skipped === r2.value?.added + r2.value.updated + r2.value.skipped && pass >= 4
    console.log(ok ? '\n=== P7 验收(入库/增量/检索)通过 ✅ ===' : '\n=== P7 验收有未达标项 ⚠️ ===')
    setTimeout(() => process.exit(ok ? 0 : 1), 200)
  })().catch((e: unknown) => {
    console.error('[acceptance] 失败:', e)
    process.exit(1)
  })
}
