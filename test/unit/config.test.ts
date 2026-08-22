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
})
