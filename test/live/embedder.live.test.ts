import { describe, expect, it } from 'vitest'
import { Embedder } from '../../src/embedder.ts'

// live 档:真 Ollama + bge-m3(1024 维)。仅 `pnpm test:live` 运行,要求本机 Ollama 在线。

const BASE = 'http://127.0.0.1:11434'
const emb = new Embedder({ baseUrl: BASE, model: 'bge-m3', dim: 1024 })

const cosine = (a: Float32Array, b: Float32Array): number => {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

describe('Embedder: live 真 Ollama', () => {
  it('ping:服务在线 + 模型可用 + 维度匹配', async () => {
    expect(await emb.ping()).toBe(true)
  })

  it('批量返回 1024 维 Float32Array,与输入对齐', async () => {
    const out = await emb.embed(['电源模块设计说明', 'power supply module'])
    expect(out).toHaveLength(2)
    expect(out[0]).toBeInstanceOf(Float32Array)
    expect(out[0]).toHaveLength(1024)
  })

  it('语义 sanity:电源(中)↔power(英) > 电源↔Recipe(中)(spike C 结论)', async () => {
    const [cn, en, recipe] = await emb.embed(['电源', 'power', 'Recipe'])
    expect(cosine(cn!, en!)).toBeGreaterThan(cosine(cn!, recipe!))
  })

  it('不存在的模型:HTTP 404 + error 字段响亮报错', async () => {
    const bad = new Embedder({ baseUrl: BASE, model: 'no-such-model-xyz', dim: 1024 })
    await expect(bad.embed(['x'])).rejects.toThrow(/404|not found/i)
  })

  it('维度配置错误:启动即报(期望 8,实得 1024)', async () => {
    const wrongDim = new Embedder({ baseUrl: BASE, model: 'bge-m3', dim: 8 })
    await expect(wrongDim.embed(['x'])).rejects.toThrow(/维度/)
  })
})
