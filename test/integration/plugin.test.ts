import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, MockAgent, setGlobalDispatcher } from 'undici'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as aomerag from '../../src/index.ts'

// 主缝集成测试(spec 测试决策):加载真实 Cordis app,全部外部行为经 ctx.tools.execute 驱动。
// Ollama 在 HTTP 边界 mock:动态响应按请求返回对应数量向量;含 FAIL_TOKEN 的文本触发 500。

const BASE = 'http://127.0.0.1:11434'
const SLOW_BASE = 'http://127.0.0.1:11435' // syncing 测试专用:慢响应 origin

let mockAgent: MockAgent
let dir: string
let dbFile: string

beforeEach(() => {
  mockAgent = new MockAgent()
  setGlobalDispatcher(mockAgent)
  // 注意:undici mock 的 reply 回调必须同步返回(async 回调会让 mock 失效 → fetch failed)
  const dynamicReply = (
    options: { body?: unknown },
  ): { statusCode: number; data: object } => {
    const body = JSON.parse(String(options.body)) as { input: string[] }
    if (body.input.some((t) => t.includes('FAIL_TOKEN'))) {
      return { statusCode: 500, data: { error: 'mock: Ollama 服务暂不可用' } }
    }
    return { statusCode: 200, data: { embeddings: body.input.map(() => [0.1, 0.2, 0.3, 0.4]) } }
  }

  mockAgent.get(BASE).intercept({ path: '/api/embed', method: 'POST' }).reply(dynamicReply).persist()
  // 慢 origin:400ms 延迟,用于让同步可观测地"挂起"
  mockAgent
    .get(SLOW_BASE)
    .intercept({ path: '/api/embed', method: 'POST' })
    .reply(dynamicReply)
    .delay(400)
    .persist()

  dir = mkdtempSync(join(tmpdir(), 'aomerag-it-'))
  dbFile = join(dir, 'kb.sqlite')
  writeFileSync(join(dir, 'power.md'), '# 电源模块\n\nGI328 电源模块设计说明。输入电压范围 3.3V 至 5V。', 'utf8')
  writeFileSync(join(dir, 'recipe.md'), '# Recipe\n\nPG 图案发生器 Lua 开发指南。时序段组成。', 'utf8')
})

let app: AppHandle | undefined

afterEach(async () => {
  setGlobalDispatcher(new Agent())
  // 显式卸载插件(关 SQLite 连接),否则 Windows 句柄未释放导致临时目录删除 EPERM
  await app?.fiber.dispose()?.catch(() => undefined)
  app = undefined
  rmSync(dir, { recursive: true, force: true })
})

interface AppHandle {
  ctx: Context
  fiber: Awaited<ReturnType<Context['plugin']>>
}

const setupApp = async (extra: Record<string, unknown> = {}): Promise<AppHandle> => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(aomerag, {
    mdDir: dir,
    dbPath: dbFile,
    embedDim: 4,
    ollamaBaseUrl: BASE,
    syncOnStart: false,
    ...extra,
  })
  app = { ctx, fiber }
  return app
}

let seq = 0
const execTool = (
  ctx: Context,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolExecutionResult> =>
  ctx.tools.execute({
    callId: CallId(`it-${++seq}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
  })

describe('插件加载与三工具契约', () => {
  it('三工具注册;空库 kb_status 报告零计数与未同步', async () => {
    const { ctx } = await setupApp()
    expect(ctx.tools.get('kb_search')).toBeDefined()
    expect(ctx.tools.get('kb_ingest')).toBeDefined()
    expect(ctx.tools.get('kb_status')).toBeDefined()

    const r = await execTool(ctx, 'kb_status')
    expect(r.isError).toBe(false)
    expect(r.value).toEqual({
      docs: 0,
      chunks: 0,
      lastSyncAt: null,
      syncing: false,
      dbPath: dbFile,
      model: 'bge-m3',
    })
  })

  it('kb_ingest 首灌返回 SyncReport,kb_status 反映入库与同步时间', async () => {
    const { ctx } = await setupApp()
    const r = await execTool(ctx, 'kb_ingest', {})
    expect(r.isError).toBe(false)
    expect(r.value).toEqual({ added: 2, updated: 0, skipped: 0, removed: 0, failed: 0, errors: [] })

    const s = await execTool(ctx, 'kb_status')
    expect(s.value).toMatchObject({ docs: 2, chunks: 2, syncing: false })
    expect((s.value as { lastSyncAt: string }).lastSyncAt).toBeTruthy()
  })

  it('kb_search 命中返回带来源的片段;content 渲染可读', async () => {
    const { ctx } = await setupApp()
    await execTool(ctx, 'kb_ingest', {})

    const r = await execTool(ctx, 'kb_search', { query: '电源模块 输入电压' })
    expect(r.isError).toBe(false)
    const v = r.value as { hits: Array<Record<string, unknown>>; status: string }
    expect(v.status).toBe('ok')
    expect(v.hits[0]).toMatchObject({ sourceDoc: 'power.md', headingPath: '电源模块' })
    expect(String(v.hits[0]!.content)).toContain('GI328')
    // content 是模型实际看到的文本:含来源与分数
    const text = r.content[0]!
    expect(text.type === 'text' && text.text.includes('power.md')).toBe(true)
  })

  it('kb_search 空库返回明确 empty 状态而非报错(spec 故事 7)', async () => {
    const { ctx } = await setupApp() // syncOnStart 关闭,库为空
    const r = await execTool(ctx, 'kb_search', { query: '电源模块' })
    expect(r.isError).toBe(false)
    expect((r.value as { status: string }).status).toBe('empty')
  })

  it('kNN 无距离阈值:语义不相关的查询仍返回最近邻(对齐蓝本设计)', async () => {
    const { ctx } = await setupApp()
    await execTool(ctx, 'kb_ingest', {})
    const r = await execTool(ctx, 'kb_search', { query: '量子纠缠加速器' })
    expect((r.value as { status: string }).status).toBe('ok')
    expect((r.value as { hits: unknown[] }).hits.length).toBeGreaterThanOrEqual(1)
  })

  it('kb_search 的 top_k 参数生效', async () => {
    const { ctx } = await setupApp()
    await execTool(ctx, 'kb_ingest', {})
    const r = await execTool(ctx, 'kb_search', { query: '指南', top_k: 1 })
    expect((r.value as { hits: unknown[] }).hits).toHaveLength(1)
  })
})

describe('容错与状态', () => {
  it('Ollama 不可用:kb_search 失败结果携带清晰错误(agent 可转述)', async () => {
    const { ctx } = await setupApp()
    await execTool(ctx, 'kb_ingest', {})
    const r = await execTool(ctx, 'kb_search', { query: 'FAIL_TOKEN 查询' })
    expect(r.isError).toBe(true)
    expect(r.error!.message).toMatch(/500|Ollama/)
  })

  it('坏文件计入 failed 不中断;kb_ingest 报告明细', async () => {
    const { ctx } = await setupApp()
    writeFileSync(join(dir, 'bad.md'), '# 坏\n\nFAIL_TOKEN 触发服务错误的内容', 'utf8')
    const r = await execTool(ctx, 'kb_ingest', {})
    expect(r.isError).toBe(false)
    const v = r.value as { added: number; failed: number; errors: string[] }
    expect(v.added).toBe(2)
    expect(v.failed).toBe(1)
    expect(v.errors[0]).toContain('bad.md')
  })

  it('同步进行中:kb_status 报告 syncing', async () => {
    const { ctx } = await setupApp({ ollamaBaseUrl: SLOW_BASE })
    const ingestPromise = execTool(ctx, 'kb_ingest', {})

    // 轮询等状态翻转(embed 挂在 400ms 延迟上)
    let syncing = false
    for (let i = 0; i < 50; i++) {
      const s = await execTool(ctx, 'kb_status')
      if ((s.value as { syncing: boolean }).syncing) {
        syncing = true
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(syncing).toBe(true)

    const done = await ingestPromise
    expect(done.isError).toBe(false)

    const after = await execTool(ctx, 'kb_status')
    expect((after.value as { syncing: boolean }).syncing).toBe(false)
    expect((after.value as { docs: number }).docs).toBe(2)
  })
})

describe('启动同步与 HMR', () => {
  it('syncOnStart: 后台自动同步完成(不阻塞加载)', async () => {
    const { ctx } = await setupApp({ syncOnStart: true })
    // 插件加载即返回;轮询后台同步完成
    for (let i = 0; i < 50; i++) {
      const s = await execTool(ctx, 'kb_status')
      if ((s.value as { docs: number }).docs === 2) break
      await new Promise((r) => setTimeout(r, 20))
    }
    const s = await execTool(ctx, 'kb_status')
    expect(s.value).toMatchObject({ docs: 2, chunks: 2, syncing: false })
    expect((s.value as { lastSyncAt: string }).lastSyncAt).toBeTruthy()
  })

  it('启动同步失败(目录不存在):告警但不炸插件,工具仍可用', async () => {
    const { ctx } = await setupApp({ syncOnStart: true, mdDir: join(dir, 'nope') })
    await new Promise((r) => setTimeout(r, 100))
    const s = await execTool(ctx, 'kb_status')
    expect(s.isError).toBe(false)
    expect((s.value as { syncing: boolean }).syncing).toBe(false)
  })

  it('HMR 卸载:工具注销、库关闭;重载可用持久化数据', async () => {
    const { ctx, fiber } = await setupApp()
    await execTool(ctx, 'kb_ingest', {})
    await fiber.dispose()
    expect(ctx.tools.get('kb_search')).toBeUndefined()

    // 重载:HMR 循环安全,库文件数据仍在
    const fiber2 = await ctx.plugin(aomerag, {
      mdDir: dir,
      dbPath: dbFile,
      embedDim: 4,
      ollamaBaseUrl: BASE,
      syncOnStart: false,
    })
    const s = await execTool(ctx, 'kb_status')
    expect(s.isError).toBe(false)
    expect((s.value as { docs: number }).docs).toBe(2)
    const r = await execTool(ctx, 'kb_search', { query: '电源模块' })
    expect((r.value as { hits: unknown[] }).hits.length).toBeGreaterThanOrEqual(1)
    await fiber2.dispose()
  })
})
