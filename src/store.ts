// SQLite 存储层:better-sqlite3 + sqlite-vec(dense KNN)+ FTS5(关键词)+ 元数据 + 文件登记。
// 固化 spike A 两个绕过模式(见 docs/spike.md):
//   坑1:vec0 显式 rowid 绑定插入必炸 → 先插 vec0 自动分配 rowid,事务内 last_insert_rowid() 回填;
//   坑2:KNN 的 JOIN ... LIMIT 报错 → LIMIT 必须直接约束 vec0 子查询。
// 三表(chunks / vec_chunks / ft_chunks)以同一 rowid 对齐;FTS 内容为 tokenize() 预分词文本(spike B)。

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import type { Chunk } from './chunker.ts'
import { tokenize } from './tokenize.ts'

export interface ChunkMeta {
  sourceDoc: string
  headingPath: string
  content: string
}

export interface FileRegistry {
  get(docId: string): { sha: string } | undefined
  set(docId: string, sha: string): void
  prune(validIds: string[]): void
  keys(): string[]
}

/** Float32Array → sqlite-vec 可绑定的 Buffer */
const toBuf = (v: Float32Array): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength)

export class KbStore {
  readonly fileRegistry: FileRegistry

  private readonly db: Database.Database
  private readonly stmts: {
    insertVec: Database.Statement
    lastRowid: Database.Statement
    insertChunk: Database.Statement
    insertFts: Database.Statement
    rowidsByDoc: Database.Statement
    countQ: Database.Statement
    knnQ: Database.Statement
    ftsQ: Database.Statement
    upsertTx: (docId: string, chunks: Chunk[], vectors: Float32Array[]) => void
    deleteTx: (docId: string) => void
  }

  /** :memory: 或文件路径(父目录自动创建;重开时自动重载 sqlite-vec 扩展) */
  static open(path: string, opts: { dim: number }): KbStore {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    const db = new Database(path)
    sqliteVec.load(db)
    return new KbStore(db, opts.dim)
  }

  private constructor(db: Database.Database, dim: number) {
    this.db = db
    db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        rowid INTEGER PRIMARY KEY,
        source_doc TEXT NOT NULL,
        heading_path TEXT NOT NULL,
        content TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${dim}]);
      CREATE VIRTUAL TABLE IF NOT EXISTS ft_chunks USING fts5(content, tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS files (
        doc_id TEXT PRIMARY KEY,
        sha TEXT NOT NULL
      );
    `)

    const insertVec = db.prepare('INSERT INTO vec_chunks(embedding) VALUES (?)')
    const lastRowid = db.prepare('SELECT last_insert_rowid() AS id')
    const insertChunk = db.prepare(
      'INSERT INTO chunks(rowid, source_doc, heading_path, content) VALUES (?, ?, ?, ?)',
    )
    const insertFts = db.prepare('INSERT INTO ft_chunks(rowid, content) VALUES (?, ?)')
    const rowidsByDoc = db.prepare('SELECT rowid FROM chunks WHERE source_doc = ?')
    const delVec = db.prepare('DELETE FROM vec_chunks WHERE rowid = ?')
    const delChunk = db.prepare('DELETE FROM chunks WHERE rowid = ?')
    const delFts = db.prepare('DELETE FROM ft_chunks WHERE rowid = ?')
    const delFile = db.prepare('DELETE FROM files WHERE doc_id = ?')

    const deleteRows = (docId: string): void => {
      const ids = rowidsByDoc.all(docId) as Array<{ rowid: number }>
      for (const { rowid } of ids) {
        delVec.run(rowid)
        delChunk.run(rowid)
        delFts.run(rowid)
      }
    }

    this.stmts = {
      insertVec,
      lastRowid,
      insertChunk,
      insertFts,
      rowidsByDoc,
      countQ: db.prepare(
        'SELECT (SELECT COUNT(DISTINCT source_doc) FROM chunks) AS docs, (SELECT COUNT(*) FROM chunks) AS chunks',
      ),
      knnQ: db.prepare(
        `SELECT rowid, distance FROM vec_chunks
         WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
      ),
      ftsQ: db.prepare(
        'SELECT rowid, rank FROM ft_chunks WHERE ft_chunks MATCH ? ORDER BY rank LIMIT ?',
      ),
      upsertTx: db.transaction((docId: string, chunks: Chunk[], vectors: Float32Array[]) => {
        deleteRows(docId)
        for (let i = 0; i < chunks.length; i++) {
          insertVec.run(toBuf(vectors[i]!))
          const rowid = (lastRowid.get() as { id: number }).id
          insertChunk.run(rowid, docId, chunks[i]!.headingPath, chunks[i]!.content)
          insertFts.run(rowid, tokenize(chunks[i]!.content))
        }
      }),
      deleteTx: db.transaction((docId: string) => {
        deleteRows(docId)
        delFile.run(docId)
      }),
    }

    this.fileRegistry = {
      get: (docId) =>
        db.prepare('SELECT sha FROM files WHERE doc_id = ?').get(docId) as
          | { sha: string }
          | undefined,
      set: (docId, sha) => {
        db.prepare(
          `INSERT INTO files(doc_id, sha) VALUES (?, ?)
           ON CONFLICT(doc_id) DO UPDATE SET sha = excluded.sha`,
        ).run(docId, sha)
      },
      prune: (validIds) => {
        if (validIds.length === 0) {
          db.prepare('DELETE FROM files').run()
        } else {
          const ph = validIds.map(() => '?').join(',')
          db.prepare(`DELETE FROM files WHERE doc_id NOT IN (${ph})`).run(...validIds)
        }
      },
      keys: () =>
        (db.prepare('SELECT doc_id FROM files ORDER BY doc_id').all() as Array<{
          doc_id: string
        }>).map((r) => r.doc_id),
    }
  }

  /** 幂等写入一个文档:事务内先删旧三表数据再插入;chunks 与 vectors 按下标对齐。不动文件登记。 */
  upsertDoc(docId: string, chunks: Chunk[], vectors: Float32Array[]): void {
    if (chunks.length !== vectors.length) {
      throw new Error(
        `upsertDoc(${docId}): chunks 数量(${chunks.length})与 vectors 数量(${vectors.length})不符`,
      )
    }
    this.stmts.upsertTx(docId, chunks, vectors)
  }

  /** 删除文档全部数据(三表 + 文件登记)。 */
  deleteDoc(docId: string): void {
    this.stmts.deleteTx(docId)
  }

  /** dense KNN(子查询 LIMIT 模式),按距离升序。 */
  knn(vec: Float32Array, k: number): Array<{ rowid: number; distance: number }> {
    return this.stmts.knnQ.all(toBuf(vec), k) as Array<{ rowid: number; distance: number }>
  }

  /** 关键词通道。入参必须是 tokenize() 后的查询串(spike B:入库/查询共用同一分词)。rank 为 FTS5 bm25,越小越好。 */
  fts(tokenizedQuery: string, k: number): Array<{ rowid: number; rank: number }> {
    return this.stmts.ftsQ.all(tokenizedQuery, k) as Array<{ rowid: number; rank: number }>
  }

  /** 按输入 rowid 顺序返回元数据(已消失的 rowid 被跳过——并发同步删除时保持宽容)。 */
  chunkMeta(rowids: number[]): ChunkMeta[] {
    if (rowids.length === 0) return []
    const ph = rowids.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT rowid, source_doc, heading_path, content FROM chunks WHERE rowid IN (${ph})`)
      .all(...rowids) as Array<{ rowid: number; source_doc: string; heading_path: string; content: string }>
    const byId = new Map(rows.map((r) => [r.rowid, r]))
    return rowids.flatMap((id) => {
      const r = byId.get(id)
      return r ? [{ sourceDoc: r.source_doc, headingPath: r.heading_path, content: r.content }] : []
    })
  }

  /** docs = 有 chunk 数据的文档数(DISTINCT source_doc);登记表只反映同步进度,不作为计数来源。 */
  docCount(): { docs: number; chunks: number } {
    return this.stmts.countQ.get() as { docs: number; chunks: number }
  }

  close(): void {
    this.db.close()
  }
}
