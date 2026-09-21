import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Agent, MockAgent, setGlobalDispatcher } from 'undici'
import { Embedder } from '../../src/embedder.ts'

// Ollama 在 HTTP 边界 mock(undici MockAgent 拦截全局 fetch,plan §4 定案)。
// 契约:批量单请求;/api/embed;错误按 HTTP 状态 + error 字段响亮抛出;维度校验。

const BASE = 'http://127.0.0.1:11434'

let mockAgent: MockAgent
beforeEach(() => {
  mockAgent = new MockAgent()
  setGlobalDispatcher(mockAgent)
})
afterEach(() => {
  setGlobalDispatcher(new Agent())
})

const newEmbedder = (dim = 8): Embedder => new Embedder({ baseUrl: BASE, model: 'bge-m3', dim })

const interceptEmbed = (status: number, body: object) =>
  mockAgent.get(BASE).intercept({ path: '/api/embed', method: 'POST' }).reply(status, body)

describe('Embedder: embed 批量', () => {
  it('批量单请求往返,返回与输入对齐的 Float32Array', async () => {
    // 只注册一次 intercept:若实现拆成多条请求,第二次将无匹配而报错
    interceptEmbed(200, { embeddings: [[1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, 0, 0]] })
    const out = await newEmbedder().embed(['电源模块', 'power supply'])
    expect(out).toHaveLength(2)
    expect(out[0]).toBeInstanceOf(Float32Array)
    expect([...out[0]!]).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    expect([...out[1]!]).toEqual([0, 1, 0, 0, 0, 0, 0, 0])
    mockAgent.assertNoPendingInterceptors()
  })

  it('空输入直接返回空数组,不发请求', async () => {
    expect(await newEmbedder().embed([])).toEqual([])
  })

  it('baseUrl 尾斜杠容忍', async () => {
    interceptEmbed(200, { embeddings: [[0, 0, 0, 0, 0, 0, 0, 0]] })
    const e = new Embedder({ baseUrl: `${BASE}/`, model: 'bge-m3', dim: 8 })
    expect(await e.embed(['x'])).toHaveLength(1)
  })
})

describe('Embedder: 错误处理', () => {
  it('404 时按 error 字段响亮抛出', async () => {
    interceptEmbed(404, { error: "model 'bge-m3' not found" })
    await expect(newEmbedder().embed(['x'])).rejects.toThrow(/404.*not found/)
  })

  it('非 2xx 且无 error 字段时仍含状态码', async () => {
    interceptEmbed(500, {})
    await expect(newEmbedder().embed(['x'])).rejects.toThrow(/500/)
  })

  it('连接失败抛"不可达"错误(含 baseUrl)', async () => {
    // MockAgent 默认禁止真实网络:未匹配的 origin 直接抛错
    const e = new Embedder({ baseUrl: 'http://127.0.0.1:1', model: 'bge-m3', dim: 8 })
    await expect(e.embed(['x'])).rejects.toThrow(/不可达|127\.0\.0\.1:1/)
  })

  it('响应缺 embeddings 字段抛格式错误', async () => {
    interceptEmbed(200, { foo: 1 })
    await expect(newEmbedder().embed(['x'])).rejects.toThrow(/embeddings|响应/)
  })

  it('embeddings 数量与输入不符抛错', async () => {
    interceptEmbed(200, { embeddings: [[0, 0, 0, 0, 0, 0, 0, 0]] })
    await expect(newEmbedder().embed(['a', 'b'])).rejects.toThrow(/数量|2/)
  })

  it('维度与配置不符抛错(含期望/实得/模型名)', async () => {
    interceptEmbed(200, { embeddings: [[0.1, 0.2, 0.3, 0.4]] }) // 4 维,配置 8
    await expect(newEmbedder(8).embed(['x'])).rejects.toThrow(/维度.*8.*4|4.*8.*bge-m3/)
  })
})

describe('Embedder: ping', () => {
  it('通道可用返回 true', async () => {
    interceptEmbed(200, { embeddings: [[0, 0, 0, 0, 0, 0, 0, 0]] })
    expect(await newEmbedder().ping()).toBe(true)
  })

  it('服务异常返回 false 而非抛错', async () => {
    interceptEmbed(500, {})
    expect(await newEmbedder().ping()).toBe(false)
  })
})

describe('Embedder: 请求超时(审查 R15)', () => {
  it('响应超过 timeoutMs 时中断并抛超时错误(无超时曾是 300s×2 挂死面)', async () => {
    mockAgent
      .get(BASE)
      .intercept({ path: '/api/embed', method: 'POST' })
      .reply(200, { embeddings: [[0, 0, 0, 0, 0, 0, 0, 0]] })
      .delay(2000)
    const e = new Embedder({ baseUrl: BASE, model: 'bge-m3', dim: 8, timeoutMs: 50 })
    const t0 = Date.now()
    await expect(e.embed(['x'])).rejects.toThrow(/超时/)
    expect(Date.now() - t0).toBeLessThan(1500) // 而非等满响应
  })

  it('正常响应不受超时影响', async () => {
    interceptEmbed(200, { embeddings: [[0, 0, 0, 0, 0, 0, 0, 0]] })
    const e = new Embedder({ baseUrl: BASE, model: 'bge-m3', dim: 8, timeoutMs: 5000 })
    expect(await e.embed(['x'])).toHaveLength(1)
  })
})
