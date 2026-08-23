// 增量同步引擎(蓝本:AomeRAG incremental_ingest):
// 递归扫描 .md → sha1 字节哈希对比登记表 → 未变跳过 / 变更先删后插 → 清理已删文件。
// 失败文件不登记(下次重试);embed 批次失败重试一次,仍失败计入 SyncReport.failed 不中断。

import { readdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { chunkMarkdown } from './chunker.ts'
import type { ChunkOptions } from './chunker.ts'
import type { KbStore } from './store.ts'

export interface SyncReport {
  added: number
  updated: number
  skipped: number
  removed: number
  failed: number
  errors: string[]
}

/** sync/retriever 依赖的最小 embedding 面;Embedder 结构满足此接口。 */
export interface EmbedsTexts {
  embed(texts: string[]): Promise<Float32Array[]>
}

export type SyncOptions = ChunkOptions & { batchSize?: number }

const DEFAULT_BATCH_SIZE = 64

const getErrorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** 递归收集 .md 文件(posix 相对路径,字典序稳定)。跳过 images/ 子树与 ~ 开头临时文件(蓝本约定)。 */
async function scanMarkdown(dir: string): Promise<Array<{ docId: string; abs: string }>> {
  const out: Array<{ docId: string; abs: string }> = []

  const walk = async (absDir: string, relPrefix: string): Promise<void> => {
    const entries = await readdir(absDir, { withFileTypes: true })
    for (const entry of entries) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (rel === 'images') continue
        await walk(join(absDir, entry.name), rel)
      } else if (
        entry.isFile() &&
        !entry.name.startsWith('~') &&
        entry.name.toLowerCase().endsWith('.md')
      ) {
        out.push({ docId: rel, abs: join(absDir, entry.name) })
      }
    }
  }

  await walk(dir, '')
  out.sort((a, b) => (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0))
  return out
}

/** 分批串行 embed;批失败重试一次,仍失败抛响亮错误。 */
async function embedAll(
  embedder: EmbedsTexts,
  texts: string[],
  batchSize: number,
): Promise<Float32Array[]> {
  const out: Float32Array[] = []
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    try {
      out.push(...(await embedder.embed(batch)))
    } catch {
      try {
        out.push(...(await embedder.embed(batch)))
      } catch (e) {
        throw new Error(
          `embedding 批次失败(第 ${Math.floor(i / batchSize) + 1} 批 ${batch.length} 条,重试一次后放弃):${getErrorMessage(e)}`,
        )
      }
    }
  }
  return out
}

export async function syncDir(
  deps: { store: KbStore; embedder: EmbedsTexts },
  dir: string,
  opts: SyncOptions,
): Promise<SyncReport> {
  const report: SyncReport = { added: 0, updated: 0, skipped: 0, removed: 0, failed: 0, errors: [] }
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE

  const dirStat = await stat(dir).catch(() => undefined)
  if (!dirStat?.isDirectory()) throw new Error(`知识目录不存在: ${dir}`)

  const files = await scanMarkdown(dir)
  const scanned = new Set(files.map((f) => f.docId))

  for (const { docId, abs } of files) {
    try {
      const data = await readFile(abs)
      const sha = createHash('sha1').update(data).digest('hex')
      const prev = deps.store.fileRegistry.get(docId)
      if (prev?.sha === sha) {
        report.skipped++
        continue
      }
      const chunks = chunkMarkdown(data.toString('utf8'), opts)
      const vectors = await embedAll(deps.embedder, chunks.map((c) => c.content), batchSize)
      await deps.store.upsertDoc(docId, chunks, vectors)
      deps.store.fileRegistry.set(docId, sha)
      if (prev) report.updated++
      else report.added++
    } catch (e) {
      report.failed++
      report.errors.push(`${docId}: ${getErrorMessage(e)}`)
    }
  }

  for (const docId of deps.store.fileRegistry.keys()) {
    if (!scanned.has(docId)) {
      await deps.store.deleteDoc(docId)
      report.removed++
    }
  }
  deps.store.fileRegistry.prune([...scanned])

  return report
}
