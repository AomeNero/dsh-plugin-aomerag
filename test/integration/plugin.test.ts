import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, MockAgent, setGlobalDispatcher } from 'undici'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import * as aomerag from '../../src/index.ts'
import { TUNABLE_NAMESPACE, STATUS_NAMESPACE, COMMAND_NAMESPACE } from '../../src/tunable.ts'

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
    callId: ToolCallId(`it-${++seq}`),
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
      lastSyncAt: '',
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

  it('并发同步互斥:同步进行中第二次 kb_ingest 响亮拒绝而非交错写库(R6)', async () => {
    const { ctx } = await setupApp({ ollamaBaseUrl: SLOW_BASE })
    const first = execTool(ctx, 'kb_ingest', {})

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

    const second = await execTool(ctx, 'kb_ingest', {})
    expect(second.isError).toBe(true)
    expect(second.error!.message).toContain('进行中')

    const done = await first
    expect(done.isError).toBe(false) // 首个同步不受影响,正常完成
  })

  it('kb_ingest 拒绝非配置目录(整库替换防线,审查 R3)', async () => {
    const { ctx } = await setupApp()
    await execTool(ctx, 'kb_ingest', {}) // 主库 2 文档
    const other = mkdtempSync(join(tmpdir(), 'aomerag-other-'))
    try {
      writeFileSync(join(other, 'x.md'), '# X\n\n另一个目录的内容', 'utf8')
      const r = await execTool(ctx, 'kb_ingest', { dir: other })
      expect(r.isError).toBe(true)
      expect(r.error!.message).toContain('仅支持')
      // 主库未被替换(旧语义:removed 2 + 只剩 X)
      const s = await execTool(ctx, 'kb_status')
      expect((s.value as { docs: number }).docs).toBe(2)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('kb_ingest 显式传配置目录:与缺省等价', async () => {
    const { ctx } = await setupApp()
    const r = await execTool(ctx, 'kb_ingest', { dir })
    expect(r.isError).toBe(false)
    expect((r.value as { added: number }).added).toBe(2)
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

  it('kb_search 对语法字符查询不再整次失败(R5)', async () => {
    const { ctx } = await setupApp()
    await execTool(ctx, 'kb_ingest', {})
    for (const q of ['C++ 指南', '(新版) 配置', 'https://example.com 说明', 'AND 流程', '电源 "管理"', '   ']) {
      const r = await execTool(ctx, 'kb_search', { query: q })
      expect(r.isError, `query=${q}`).toBe(false)
    }
  })

  it('kb_search 的 top_k 越界值钳制到 [1,100],不再穿透 SQLite/占位符(R13)', async () => {
    const { ctx } = await setupApp()
    await execTool(ctx, 'kb_ingest', {})
    // 负值曾 = SQLite LIMIT -1 无限制;0 曾双通道全空错误归因 empty;超大曾击穿 IN 占位符
    // (浮点如 2.7 由 dsh-tools 的 integer 参数校验在上游拒绝,不在本钳制面)
    for (const [bad, expectedLen] of [[-5, 1], [0, 1], [1e9, 2]] as const) {
      const r = await execTool(ctx, 'kb_search', { query: '指南', top_k: bad })
      expect(r.isError, `top_k=${bad}`).toBe(false)
      expect((r.value as { hits: unknown[] }).hits, `top_k=${bad}`).toHaveLength(expectedLen)
    }
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
    // 插件加载即返回;轮询后台同步完成(docs 到位且 syncing 翻回 false——异步存储下二者有尾工窗口)
    for (let i = 0; i < 50; i++) {
      const s = await execTool(ctx, 'kb_status')
      const v = s.value as { docs: number; syncing: boolean }
      if (v.docs === 2 && !v.syncing) break
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

  it('settings 用户层覆盖热更新:web 表单改 topK 后检索立即生效', async () => {
    // 方案 B 数据层:settings 服务挂 FileSettingsProvider(临时文档),插件注册 namespace,
    // 用户层写入(update = web 表单保存的同一路径)→ watch 热更新 runtime
    const settingsFile = join(dir, 'settings.yaml')
    writeFileSync(settingsFile, '', 'utf8')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FileSettingsProvider, { path: settingsFile })
    const fiber = await ctx.plugin(aomerag, {
      mdDir: dir,
      dbPath: dbFile,
      embedDim: 4,
      ollamaBaseUrl: BASE,
      syncOnStart: false,
      topK: 6,
    })
    app = { ctx, fiber }

    await execTool(ctx, 'kb_ingest', {})
    let r = await execTool(ctx, 'kb_search', { query: '指南' })
    let hits = (r.value as { hits: unknown[] }).hits
    expect(hits.length).toBeGreaterThanOrEqual(1) // 默认 topK=6,多命中

    await ctx.settings.update(TUNABLE_NAMESPACE, { topK: 1 }) // 用户层覆盖(= web 表单保存路径)
    await new Promise((resolve) => setTimeout(resolve, 150)) // watch 异步触发

    r = await execTool(ctx, 'kb_search', { query: '指南' })
    hits = (r.value as { hits: unknown[] }).hits
    expect(hits).toHaveLength(1) // 热更新后 topK=1 生效
  })

  it('settings 历史脏值(修复前持久化的 0/超大值):注册钳制自愈不炸(R1/R24)', async () => {
    // 拒绝型 schema 会在 register 同步 resolve 时 throw → inject 块死亡且 cordis 静默;
    // 钳制型 schema 让老库直接收敛到安全区间继续工作
    const settingsFile = join(dir, 'settings-dirty.yaml')
    writeFileSync(
      settingsFile,
      ['aomerag:', '  embedBatchSize: 0', '  topK: 999999', '  chunkOverlap: 999999'].join('\n'),
      'utf8',
    )
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FileSettingsProvider, { path: settingsFile })
    const fiber = await ctx.plugin(aomerag, {
      mdDir: dir, dbPath: dbFile, embedDim: 4, ollamaBaseUrl: BASE, syncOnStart: false,
    })
    app = { ctx, fiber }

    const t = ctx.settings.get(TUNABLE_NAMESPACE) as Record<string, number> | undefined
    expect(t, 'settings 注册成功').toBeDefined()
    expect(t).toMatchObject({ embedBatchSize: 1, topK: 100 }) // 钳到边界
    await execTool(ctx, 'kb_ingest', {}) // batchSize=1 同步正常走完(0 曾永久挂死)
    const r = await execTool(ctx, 'kb_search', { query: '指南' })
    expect(r.isError).toBe(false)
    expect((r.value as { hits: unknown[] }).hits.length).toBeGreaterThanOrEqual(1) // 检索链路正常
  })

  it('崩溃残留命令:加载时复位为 none,按钮不再永久锁死(R17)', async () => {
    // 命令执行中进程退出 → settings.yaml 残留 action → 重启后 watch 不触发、无复位路径,
    // 浏览器 busy 恒真三按钮禁用;加载时必须复位
    const settingsFile = join(dir, 'settings-stale.yaml')
    writeFileSync(
      settingsFile,
      ['aomerag-command:', '  action: rebuild', '  nonce: 42'].join('\n'),
      'utf8',
    )
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FileSettingsProvider, { path: settingsFile })
    const fiber = await ctx.plugin(aomerag, {
      mdDir: dir, dbPath: dbFile, embedDim: 4, ollamaBaseUrl: BASE, syncOnStart: false,
    })
    app = { ctx, fiber }

    for (let i = 0; i < 50; i++) {
      const cmd = ctx.settings.get(COMMAND_NAMESPACE) as { action?: string } | undefined
      if (cmd?.action === 'none') return
      await new Promise((r) => setTimeout(r, 30))
    }
    throw new Error('残留命令未在超时内复位')
  })

  it('同步进行中的按钮命令被拒绝且通道回清,不再静默吞(R16)', async () => {
    const settingsFile = join(dir, 'settings-busy.yaml')
    writeFileSync(settingsFile, '', 'utf8')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FileSettingsProvider, { path: settingsFile })
    const fiber = await ctx.plugin(aomerag, {
      mdDir: dir, dbPath: dbFile, embedDim: 4, ollamaBaseUrl: SLOW_BASE, syncOnStart: false,
    })
    app = { ctx, fiber }

    // 命令通道触发慢同步
    await ctx.settings.update(COMMAND_NAMESPACE, { action: 'sync', nonce: 1 })
    let syncing = false
    for (let i = 0; i < 100; i++) {
      const s = ctx.settings.get(STATUS_NAMESPACE) as { syncing?: boolean } | undefined
      if (s?.syncing === true) {
        syncing = true
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(syncing).toBe(true)

    // 同步进行中写入第二命令:此前被静默吞(消费后丢弃、通道卡死)
    await ctx.settings.update(COMMAND_NAMESPACE, { action: 'clear', nonce: 2 })
    let rejected = false
    for (let i = 0; i < 100; i++) {
      const cmd = ctx.settings.get(COMMAND_NAMESPACE) as { action?: string } | undefined
      if (cmd?.action === 'none') {
        rejected = true // 被拒 + 通道回清
        break
      }
      await new Promise((r) => setTimeout(r, 30))
    }
    expect(rejected).toBe(true)
    // 判别点:旧代码的通道回清发生在首个命令 finally(同步已结束);新代码即时拒绝,
    // 回清时同步必然仍在进行
    const duringSync = ctx.settings.get(STATUS_NAMESPACE) as { syncing?: boolean } | undefined
    expect(duringSync?.syncing).toBe(true)

    // 等首个慢同步结束,确认 clear 未被执行(文档仍在)
    for (let i = 0; i < 100; i++) {
      const s = ctx.settings.get(STATUS_NAMESPACE) as { syncing?: boolean } | undefined
      if (s?.syncing === false) break
      await new Promise((r) => setTimeout(r, 30))
    }
    const st = await execTool(ctx, 'kb_status')
    expect((st.value as { docs: number }).docs).toBe(2)
  })

  it('命令通道:按钮写 command → Host 执行 → 状态快照自动更新;clear 清库', async () => {
    const settingsFile = join(dir, 'settings-cmd.yaml')
    writeFileSync(settingsFile, '', 'utf8')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FileSettingsProvider, { path: settingsFile })
    const fiber = await ctx.plugin(aomerag, {
      mdDir: dir,
      dbPath: dbFile,
      embedDim: 4,
      ollamaBaseUrl: BASE,
      syncOnStart: false,
    })
    app = { ctx, fiber }

    await execTool(ctx, 'kb_ingest', {}) // 灌 2 文档
    // publishStatus 是异步写,轮询等快照落定
    const waitForStatus = async (pred: (s: Record<string, unknown>) => boolean): Promise<void> => {
      for (let i = 0; i < 100; i++) {
        const s = ctx.settings.get(STATUS_NAMESPACE) as Record<string, unknown> | undefined
        if (s !== undefined && pred(s)) return
        await new Promise((r) => setTimeout(r, 30))
      }
      throw new Error('状态快照未在超时内达到预期')
    }
    await waitForStatus((s) => s.docs === 2)
    let st = ctx.settings.get(STATUS_NAMESPACE) as Record<string, number>
    expect(st.docs).toBe(2)
    expect(st.dbSizeMB).toBeGreaterThanOrEqual(0)

    // 模拟按钮:写命令(action+nonce),Host watch 执行后清回 action='none'
    const runCommand = async (action: 'sync' | 'rebuild' | 'clear', nonce: number): Promise<void> => {
      await ctx.settings.update(COMMAND_NAMESPACE, { action, nonce })
      for (let i = 0; i < 100; i++) {
        const cmd = ctx.settings.get(COMMAND_NAMESPACE) as { action?: string } | undefined
        if (cmd?.action === 'none') return
        await new Promise((r) => setTimeout(r, 30))
      }
      throw new Error(`命令 ${action} 未在超时内完成`)
    }

    await runCommand('sync', 1)
    await waitForStatus((s) => String(s.lastSyncAt ?? '') !== '') // 同步完成时间已写入快照

    await runCommand('rebuild', 2)
    await waitForStatus((s) => {
      const r = s.lastReport as { updated?: number } | undefined
      // force 重建:登记行保留 → prev 存在计 updated(旧 prune([]) 写法计 added 且已删文件孤儿)
      return r?.updated === 2 && s.chunks === 2
    })

    await runCommand('clear', 3)
    await waitForStatus((s) => s.docs === 0 && s.chunks === 0)
    const s = await execTool(ctx, 'kb_status', {})
    expect((s.value as { docs: number }).docs).toBe(0) // 工具面与状态面一致
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
