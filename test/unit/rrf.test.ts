import { describe, expect, it } from 'vitest'
import { rrfFuse, type Scored } from '../../src/rrf.ts'

// RRF 标准公式:score(d) = Σ 1/(k + rank),rank 从 1 起按各通道输入顺序。
// 蓝本 AomeRAG 用 zvec RrfReRanker(库内置,k 默认 60),此处为等价 TS 移植。

const S = (id: number, score: number): Scored => ({ id, score })

describe('rrfFuse: 融合分计算', () => {
  it('共有项融合分 = Σ 1/(k+rank),rank 从 1 起', () => {
    const out = rrfFuse([S(1, 0.9), S(2, 0.8)], [S(1, 5), S(3, 4)], 60)
    const byId = new Map(out.map((s) => [s.id, s.score]))
    expect(byId.get(1)).toBeCloseTo(1 / 61 + 1 / 61, 10)
    expect(byId.get(2)).toBeCloseTo(1 / 62, 10)
    expect(byId.get(3)).toBeCloseTo(1 / 62, 10)
  })

  it('原始分数不参与融合,只按排名位置', () => {
    // id2 的原始分数远高于 id1,但排名第二 → 融合分更低
    const out = rrfFuse([S(1, 0.001), S(2, 999)], [], 60)
    expect(out[0]!.id).toBe(1)
  })

  it('k 默认 60(对齐 AomeRAG / zvec RrfReRanker)', () => {
    const withDefault = rrfFuse([S(1, 1)], [S(1, 1)])
    expect(withDefault[0]!.score).toBeCloseTo(2 / 61, 10)
  })
})

describe('rrfFuse: 排序', () => {
  it('双通道命中的项排在单通道项之前', () => {
    const out = rrfFuse([S(5, 0.7), S(6, 0.6)], [S(7, 3), S(5, 2)], 60)
    expect(out[0]!.id).toBe(5)
    expect(out.map((s) => s.id)).toEqual([5, 7, 6])
  })

  it('融合分相同时按稳定次序(dense 通道项在前)', () => {
    const out = rrfFuse([S(2, 0.9)], [S(3, 0.1)], 60)
    expect(out.map((s) => s.id)).toEqual([2, 3])
    expect(out[0]!.score).toBe(out[1]!.score)
  })

  it('单通道输入退化为该通道排名序', () => {
    const out = rrfFuse([S(9, 0.1), S(4, 0.9), S(7, 0.5)], [], 60)
    expect(out.map((s) => s.id)).toEqual([9, 4, 7])
  })
})

describe('rrfFuse: 边界', () => {
  it('双空输入返回空数组', () => {
    expect(rrfFuse([], [])).toEqual([])
  })

  it('显式 k 参与分母', () => {
    const out = rrfFuse([S(1, 1)], [], 1)
    expect(out[0]!.score).toBeCloseTo(1 / 2, 10)
  })
})
