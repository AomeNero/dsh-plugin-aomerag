// P5 冒烟:经真实 cordis loader(cordis.yml)加载插件,真 Ollama bge-m3 驱动三工具。
// 运行:cd D:\Code\AomeRAG && node D:\GitHub\deepseek-harness\vendor\cordis\bin.js
import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as aomerag from '../src/index.ts'

export const name = 'aome-smoke'
export const inject = ['tools']

export function apply(ctx: Context) {
  void (async () => {
    const fiber = await ctx.plugin(aomerag, {
      mdDir: './data/md',
      dbPath: './data/aomerag.sqlite',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      embedModel: 'bge-m3',
      embedDim: 1024,
      syncOnStart: false,
    })

    let n = 0
    const exec = (name: string, args: Record<string, unknown> = {}) =>
      ctx.tools.execute({
        callId: ToolCallId(`smoke-${++n}`),
        name,
        arguments: args,
        signal: new AbortController().signal,
      })

    const ing = await exec('kb_ingest', {})
    console.log('[smoke] kb_ingest:', JSON.stringify(ing.value ?? ing.error))

    const st = await exec('kb_status', {})
    console.log('[smoke] kb_status:', JSON.stringify(st.value ?? st.error))

    const q = await exec('kb_search', { query: '电源模块 输入电压' })
    if (q.isError) {
      console.log('[smoke] kb_search 失败:', JSON.stringify(q.error))
    } else {
      const v = q.value as { hits: Array<{ sourceDoc: string; headingPath: string; score: number }>; status: string }
      console.log('[smoke] kb_search:', v.status, '| 首命中:', JSON.stringify(v.hits[0]))
      const text = q.content[0]
      console.log('[smoke] 模型可见文本预览:', text && text.type === 'text' ? text.text.slice(0, 160) : '')
    }

    await fiber.dispose()
    console.log('[smoke] ✅ cordis loader + 真 Ollama 全链路通过')
    setTimeout(() => process.exit(0), 200)
  })().catch((e: unknown) => {
    console.error('[smoke] ❌ 失败:', e)
    process.exit(1)
  })
}
