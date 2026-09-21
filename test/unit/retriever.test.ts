import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KbStore } from '../../src/store.ts'
import { hybridSearch } from '../../src/retriever.ts'
import type { EmbedsTexts } from '../../src/sync.ts'

// 混合检索编排:dense KNN + FTS → RRF 融合 → topK,Hit 带 RRF 融合分。
// mock embedder 按文本关键词返回簇向量,使 dense 通道语义可控。

const DIM = 4

/** 语义簇:含「电源」→ [1,0,..];含「Recipe」→ [0,1,..];其他 → 中间向量 */
const clusterEmbedder: EmbedsTexts = {
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      if (t.includes('电源')) return Float32Array.from([1, 0, 0, 0])
      if (t.includes('Recipe')) return Float32Array.from([0, 1, 0, 0])
      return Float32Array.from([0.5, 0.5, 0, 0])
    })
  },
}

let store: KbStore
beforeEach(() => {
  store = KbStore.open(':memory:', { dim: DIM })
})
afterEach(async () => {
  await store.close()
})

const seed = async (docId: string, content: string, headingPath: string, cluster: 'power' | 'recipe'): Promise<void> => {
  await store.upsertDoc(
    docId,
    [{ content, headingPath, index: 0 }],
    [cluster === 'power' ? Float32Array.from([1, 0, 0, 0]) : Float32Array.from([0, 1, 0, 0])],
  )
}

describe('hybridSearch', () => {
  it('双通道都命中的文档排最前,Hit 结构完整,score 为 RRF 融合分', async () => {
    await seed('power.md', 'GI328 电源模块设计说明', '电源', 'power')
    await seed('recipe.md', 'PG 图案发生器 Recipe 开发指南', 'Recipe', 'recipe')
    const hits = await hybridSearch({ store, embedder: clusterEmbedder }, '电源模块设计', 6)
    expect(hits.length).toBe(2)
    expect(hits[0]!.sourceDoc).toBe('power.md') // 双通道命中 > 单通道
    expect(hits[0]).toMatchObject({
      sourceDoc: 'power.md',
      headingPath: '电源',
      content: 'GI328 电源模块设计说明',
    })
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
  })

  it('唯一候选的融合分为 1/61 + 1/61(两通道均 rank1,k=60)', async () => {
    await seed('only.md', 'GI328 电源模块设计说明', '电源', 'power')
    const hits = await hybridSearch({ store, embedder: clusterEmbedder }, '电源模块设计说明', 6)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.score).toBeCloseTo(1 / 61 + 1 / 61, 6)
  })

  it('FTS 通道独立贡献(向量不近但关键词命中)', async () => {
    // 查询词不含簇关键词 → 中间向量,dense 无明显近邻;但 FTS 命中目标文档
    await seed('target.md', 'GI328 接口定义与 Recipe 时序段', '接口', 'recipe')
    const hits = await hybridSearch({ store, embedder: clusterEmbedder }, 'GI328', 6)
    expect(hits.map((h) => h.sourceDoc)).toContain('target.md')
  })

  it('topK 截断', async () => {
    await seed('a.md', '电源模块甲', 'A', 'power')
    await seed('b.md', '电源模块乙', 'B', 'power')
    await seed('c.md', '电源模块丙', 'C', 'power')
    await seed('d.md', 'Recipe 指南', 'D', 'recipe')
    const hits = await hybridSearch({ store, embedder: clusterEmbedder }, '电源模块', 2)
    expect(hits).toHaveLength(2)
    expect(hits.every((h) => h.content.includes('电源'))).toBe(true)
  })

  it('空库返回空数组', async () => {
    expect(await hybridSearch({ store, embedder: clusterEmbedder }, '任何', 6)).toEqual([])
  })

  it('特殊字符查询不再击穿 FTS5 语法(R5:此前 5/6 自然查询整次检索抛错)', async () => {
    await seed('power.md', 'C++ 电源管理指南', '电源', 'power')
    await seed('recipe.md', '(新版) 配置与 https://example.com 说明', '配置', 'recipe')
    for (const q of ['C++ 指南', '(新版) 配置', 'https://example.com 说明', 'AND 流程', '电源 "管理"']) {
      const hits = await hybridSearch({ store, embedder: clusterEmbedder }, q, 6)
      expect(Array.isArray(hits), `query=${q}`).toBe(true) // 不抛即通过;dense 通道照常工作
    }
  })

  it('裸 OR 不再被解析为布尔操作符(同根静默变体:召回被语义劫持)', async () => {
    await seed('or.md', 'OR 操作符的使用说明', 'X', 'power')
    const hits = await hybridSearch({ store, embedder: clusterEmbedder }, 'OR 操作符', 6)
    expect(hits.map((h) => h.sourceDoc)).toContain('or.md')
  })

  it('纯空白查询短路:不触发 embed 也不查 FTS(R5 补充)', async () => {
    let calls = 0
    const counting: EmbedsTexts = {
      async embed(texts: string[]) {
        calls++
        return texts.map(() => Float32Array.from([0, 0, 0, 0]))
      },
    }
    const hits = await hybridSearch({ store, embedder: counting }, '   ', 6)
    expect(hits).toEqual([])
    expect(calls).toBe(0)
  })
})
