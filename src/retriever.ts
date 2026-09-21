// 混合检索编排(蓝本:AomeRAG Retriever.search + ZvecStore.hybrid_query):
// dense KNN + FTS 双通道 → RRF 融合 → top_k,Hit 携带来源与 RRF 融合分。

import type { KbStore } from './store.ts'
import type { EmbedsTexts } from './sync.ts'
import { toFtsMatchQuery } from './tokenize.ts'
import { rrfFuse } from './rrf.ts'

export interface Hit {
  sourceDoc: string
  headingPath: string
  content: string
  score: number
}

export async function hybridSearch(
  deps: { store: KbStore; embedder: EmbedsTexts },
  query: string,
  topK: number,
  rrfK = 60,
): Promise<Hit[]> {
  const ftsQuery = toFtsMatchQuery(query)
  if (ftsQuery === '') return [] // 纯空白/空查询:两通道都无意义,不触发 embed

  const [queryVec] = await deps.embedder.embed([query])
  if (!queryVec) return []

  // dense 通道超取一倍:崩溃窗口的 Lance 孤儿向量(不在 SQLite 行集)与并发删除
  // 的已消失行会在 meta 过滤时被丢弃,先 slice 会挤占召回槽位(审查 R7)
  const dense = await deps.store.knn(queryVec, topK * 2)
  const fts = deps.store.fts(ftsQuery, topK)
  const fused = rrfFuse(
    dense.map((d) => ({ id: d.rowid, score: d.distance })),
    fts.map((f) => ({ id: f.rowid, score: f.rank })),
    rrfK,
  )

  const metas = deps.store.chunkMeta(fused.map((f) => f.id))
  const metaById = new Map(metas.map((m) => [m.rowid, m]))
  return fused
    .flatMap((f) => {
      const m = metaById.get(f.id)
      return m
        ? [{ sourceDoc: m.sourceDoc, headingPath: m.headingPath, content: m.content, score: f.score }]
        : []
    })
    .slice(0, topK)
}
