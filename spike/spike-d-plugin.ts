// Spike D: 独立目录插件被 dsh (cordis loader) 加载的验证
// 复刻教程 07 的 greet 工具 + 自驱动执行 (无需模型/密钥)
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

export const name = 'aome-spike-d'
export const inject = ['tools']

export function apply(ctx: Context) {
  console.log('[spike-d] 插件已加载, cwd =', process.cwd())

  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet the named person.',
    parameters: {
      name: { type: 'string', required: true, description: 'Who to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { name: string }) {
      return `Hello, ${args.name}! (from 独立目录插件 D:\\Code\\AomeRAG)`
    },
  }))

  void (async () => {
    try {
      const result = await ctx.tools.execute({
        callId: ToolCallId('spike-d-1'),
        name: 'greet',
        arguments: { name: 'AomeRAG' },
        signal: new AbortController().signal,
      })
      console.log('[spike-d] 工具执行结果:', JSON.stringify(result.content))
      console.log('[spike-d] ✅ 独立目录插件加载+注册+执行 全链路通过')
    } catch (e) {
      console.log('[spike-d] ❌ 工具执行失败:', e)
    } finally {
      // 验证完就退出进程
      setTimeout(() => process.exit(0), 200)
    }
  })()
}
