// 混合检索编排(蓝本:AomeRAG Retriever.search + ZvecStore.hybrid_query):
// dense KNN + FTS 双通道 → RRF 融合 → top_k,Hit 携带来源与 RRF 融合分。

import type { KbStore } from './store.ts'
import type { EmbedsTexts } from './sync.ts'
import { tokenize } from './tokenize.ts'
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
  const [queryVec] = await deps.embedder.embed([query])
  if (!queryVec) return []

  const dense = deps.store.knn(queryVec, topK)
  const fts = deps.store.fts(tokenize(query), topK)
  const fused = rrfFuse(
    dense.map((d) => ({ id: d.rowid, score: d.distance })),
    fts.map((f) => ({ id: f.rowid, score: f.rank })),
    rrfK,
  ).slice(0, topK)

  const metas = deps.store.chunkMeta(fused.map((f) => f.id))
  const metaById = new Map(metas.map((m) => [m.rowid, m]))
  return fused.flatMap((f) => {
    const m = metaById.get(f.id)
    return m
      ? [{ sourceDoc: m.sourceDoc, headingPath: m.headingPath, content: m.content, score: f.score }]
      : []
  })
}
