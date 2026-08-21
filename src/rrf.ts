// RRF(Reciprocal Rank Fusion)融合排序:score(d) = Σ 1/(k + rank)。
// 蓝本 AomeRAG 用 zvec 内置 RrfReRanker,此处为等价移植;k 默认 60。
// rank 按各通道输入顺序从 1 起(调用方保证通道内已按各自分数降序),原始分数不参与计算。

export interface Scored {
  id: number
  score: number
}

export function rrfFuse(dense: Scored[], fts: Scored[], k = 60): Scored[] {
  const scores = new Map<number, number>()
  for (const channel of [dense, fts]) {
    let rank = 1
    for (const { id } of channel) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank))
      rank++
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}
