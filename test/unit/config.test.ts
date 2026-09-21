import { describe, expect, it } from 'vitest'
import { Config } from '../../src/config.ts'

// 默认值对齐 AomeRAG(plan §2 Config 字段表)。

describe('Config', () => {
  it('缺省配置填充全部默认值', () => {
    expect(Config({})).toMatchObject({
      mdDir: './data/md',
      dbPath: './data/aomerag.sqlite',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      embedModel: 'bge-m3',
      embedDim: 1024,
      chunkTarget: 1200,
      chunkMax: 1600,
      chunkOverlap: 200,
      topK: 6,
      rrfK: 60,
      embedBatchSize: 64,
      syncOnStart: true,
    })
  })

  it('显式值覆盖默认,未给字段保持默认', () => {
    const cfg = Config({ topK: 3, mdDir: 'D:/kb' })
    expect(cfg).toMatchObject({ topK: 3, mdDir: 'D:/kb', chunkTarget: 1200, syncOnStart: true })
  })

  it('部署配置数值越界响亮失败(spec #21:加载期暴露,审查 R1/R2/R13/R24)', () => {
    expect(() => Config({ embedBatchSize: 0 })).toThrow() // 曾使同步永久挂死
    expect(() => Config({ chunkTarget: 0 })).toThrow() // 曾使 chunker 崩溃
    expect(() => Config({ chunkMax: 0 })).toThrow()
    expect(() => Config({ topK: -5 })).toThrow()
    expect(() => Config({ topK: 101 })).toThrow()
    expect(() => Config({ embedBatchSize: 1025 })).toThrow()
  })

  it('部署配置边界值接受', () => {
    expect(Config({ embedBatchSize: 1, chunkTarget: 100, chunkMax: 200, topK: 1, rrfK: 1 })).toMatchObject({
      embedBatchSize: 1, chunkTarget: 100, chunkMax: 200, topK: 1, rrfK: 1,
    })
  })
})
