// 存储层(A 方案双存储,2026-08-23 LanceDB 迁移):
//   LanceDB 目录 = 向量索引(id 与 chunks.rowid 对齐,默认暴力扫描,L2² 距离与 vec0 语义连续);
//   SQLite = 元数据 + FTS5 中文检索 + 文件登记(rowid 自动分配,AUTOINCREMENT 不复用)。
// 跨库无原子事务:upsert 先提交 SQLite 事务,再 Lance delete(旧 id)→ add(新);
// 崩溃窗口最多留下 Lance 孤儿向量或 knn 暂缺(knn/fts → chunkMeta 的宽容对齐兜底)。
// 历史:spike A 的 vec0 两坑(显式 rowid 绑定 / KNN 子查询 LIMIT)随 vec0 虚拟表一起退役。

import { mkdirSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import * as lancedb from '@lancedb/lancedb'
import type { Chunk } from './chunker.ts'
import { tokenize } from './tokenize.ts'

export interface ChunkMeta {
  rowid: number
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

const LANCE_TABLE = 'vec_chunks'

export class KbStore {
  readonly fileRegistry: FileRegistry

  private readonly db: Database.Database
  private readonly lanceUri: string
  private lanceConn: Promise<lancedb.Connection> | undefined
  private lanceTablePromise: Promise<lancedb.Table | undefined> | undefined
  private closed = false

  /** ':memory:'(进程内唯一实例)或 SQLite 文件路径;Lance 目录 = 同名去扩展名 + .lance */
  static open(path: string, opts: { dim: number }): KbStore {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    return new KbStore(path, opts.dim)
  }

  private constructor(sqlitePath: string, _dim: number) {
    if (sqlitePath === ':memory:') {
      this.lanceUri = `memory://aomerag-${randomUUID()}`
    } else {
      const p = parse(sqlitePath)
      this.lanceUri = join(p.dir, `${p.name}.lance`)
    }
    this.db = new Database(sqlitePath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        source_doc TEXT NOT NULL,
        heading_path TEXT NOT NULL,
        content TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS ft_chunks USING fts5(content, tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS files (
        doc_id TEXT PRIMARY KEY,
        sha TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    const db = this.db
    const insertChunk = db.prepare(
      'INSERT INTO chunks(source_doc, heading_path, content) VALUES (?, ?, ?)',
    )
    const insertFts = db.prepare('INSERT INTO ft_chunks(rowid, content) VALUES (?, ?)')
    const rowidsByDoc = db.prepare('SELECT rowid FROM chunks WHERE source_doc = ?')
    const delChunk = db.prepare('DELETE FROM chunks WHERE rowid = ?')
    const delFts = db.prepare('DELETE FROM ft_chunks WHERE rowid = ?')
    const delFile = db.prepare('DELETE FROM files WHERE doc_id = ?')
    const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
    const setMetaStmt = db.prepare(
      `INSERT INTO meta(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )

    const deleteRows = (docId: string): number[] => {
      const ids = (rowidsByDoc.all(docId) as Array<{ rowid: number }>).map((r) => r.rowid)
      for (const id of ids) {
        delChunk.run(id)
        delFts.run(id)
      }
      return ids
    }

    this.upsertSqliteTx = db.transaction(
      (docId: string, chunks: Chunk[]): { oldIds: number[]; newIds: number[] } => {
        const oldIds = deleteRows(docId)
        const newIds: number[] = []
        for (const c of chunks) {
          insertChunk.run(docId, c.headingPath, c.content)
          const rowid = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
          insertFts.run(rowid, tokenize(c.content))
          newIds.push(rowid)
        }
        return { oldIds, newIds }
      },
    )
    this.deleteSqliteTx = db.transaction((docId: string): number[] => {
      const ids = deleteRows(docId)
      delFile.run(docId)
      return ids
    })

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

    this.getMeta = (key) => (getMetaStmt.get(key) as { value: string } | undefined)?.value
    this.setMeta = (key, value) => setMetaStmt.run(key, value)
  }

  /** 库级元数据(embedding 模型指纹等;审查 R18)。 */
  readonly getMeta: (key: string) => string | undefined
  readonly setMeta: (key: string, value: string) => void

  private readonly upsertSqliteTx: (docId: string, chunks: Chunk[]) => {
    oldIds: number[]
    newIds: number[]
  }
  private readonly deleteSqliteTx: (docId: string) => number[]

  /** 惰性 Lance 连接(:memory: 实例间天然隔离,连接由本 store 独占持有)。
   *  close 后栅栏拒绝(审查 R8):旧实现的 ??= 会在 dispose 窗口内被 in-flight
   *  检索重建连接并存回,新句柄永无 close,Windows 上宿主删数据目录即 EPERM。 */
  private lanceConnect(): Promise<lancedb.Connection> {
    if (this.closed) throw new Error('KbStore 已关闭(插件卸载中)')
    this.lanceConn ??= lancedb.connect(this.lanceUri)
    return this.lanceConn
  }

  /** 惰性取表。表不存在(空库)→ 缓存 undefined(稳定态);打开失败但表存在
   *  (AV/同步盘瞬时占用)→ 不缓存负结果,下次调用重试(审查 R14:旧实现一次
   *  瞬时 IO 错被永久缓存,dense 通道静默全灭 + 后续写入全部 failed 直至重启)。 */
  private lanceTable(): Promise<lancedb.Table | undefined> {
    if (this.closed) return Promise.reject(new Error('KbStore 已关闭(插件卸载中)'))
    this.lanceTablePromise ??= this.lanceConnect()
      .then(async (conn) => {
        try {
          return await conn.openTable(LANCE_TABLE)
        } catch (e) {
          const names = await conn.tableNames()
          if (!names.includes(LANCE_TABLE)) return undefined // 空库,稳定
          this.lanceTablePromise = undefined // 瞬时失败:允许重试
          throw e
        }
      })
    return this.lanceTablePromise
  }

  /**
   * 幂等写入一个文档:SQLite 事务(删旧三表数据 + 插新,AUTOINCREMENT rowid)提交后,
   * Lance 侧先 delete 旧 id 再 add 新向量(delete 在前保证 rowid 语义上不重叠双份)。
   */
  async upsertDoc(docId: string, chunks: Chunk[], vectors: Float32Array[]): Promise<void> {
    if (chunks.length !== vectors.length) {
      throw new Error(
        `upsertDoc(${docId}): chunks 数量(${chunks.length})与 vectors 数量(${vectors.length})不符`,
      )
    }
    const { oldIds, newIds } = this.upsertSqliteTx(docId, chunks)

    const table = await this.lanceTable()
    if (table === undefined) {
      if (newIds.length === 0) return
      // 空库首灌:首批数据即 schema(id: int, vector: fixed[dim])
      const conn = await this.lanceConnect()
      const created = await conn.createTable(
        LANCE_TABLE,
        newIds.map((id, i) => ({ id, vector: vectors[i]! })),
      )
      this.lanceTablePromise = Promise.resolve(created)
      return
    }
    // 已有表:先删旧 id 再加新(AUTOINCREMENT 保证新旧 id 不重叠;删旧在前则语义为覆盖)
    if (oldIds.length > 0) await table.delete(`id IN (${oldIds.join(',')})`)
    if (newIds.length > 0) {
      await table.add(newIds.map((id, i) => ({ id, vector: vectors[i]! })))
    }
  }

  /** 删除文档全部数据(Lance 向量 + SQLite 三表 + 文件登记)。 */
  async deleteDoc(docId: string): Promise<void> {
    const ids = this.deleteSqliteTx(docId)
    if (ids.length === 0) return
    const table = await this.lanceTable()
    if (table !== undefined) await table.delete(`id IN (${ids.join(',')})`)
  }

  /** 清除 Lance 中不在 SQLite chunks 行集内的孤儿向量(崩溃窗口产物,审查 R7)。
   *  孤儿 id 不在任何删除路径的行集里,旧实现唯一清除手段是手删 .lance 目录。
   *  全扫 id 列,万级库开销可忽略;调用方在同步/清空收尾时调用,失败不影响主流程。 */
  async gcOrphans(): Promise<number> {
    const table = await this.lanceTable()
    if (table === undefined) return 0
    const rows = (await table.query().select(['id']).toArray()) as Array<{ id: number }>
    const sqliteIds = new Set(
      (this.db.prepare('SELECT rowid FROM chunks').all() as Array<{ rowid: number }>).map(
        (r) => r.rowid,
      ),
    )
    const orphans = rows.map((r) => r.id).filter((id) => !sqliteIds.has(id))
    if (orphans.length === 0) return 0
    await table.delete(`id IN (${orphans.join(',')})`)
    return orphans.length
  }

  /** dense KNN(Lance 向量检索,距离升序;空库返回空数组)。 */
  async knn(vec: Float32Array, k: number): Promise<Array<{ rowid: number; distance: number }>> {
    const table = await this.lanceTable()
    if (table === undefined) return []
    const rows = await table.search(vec).limit(k).toArray()
    return rows.map((r) => ({ rowid: r.id as number, distance: Number(r._distance) }))
  }

  /** 关键词通道。入参必须是 tokenize() 后的查询串(spike B:入库/查询共用同一分词)。rank 为 FTS5 bm25,越小越好。 */
  fts(tokenizedQuery: string, k: number): Array<{ rowid: number; rank: number }> {
    return this.db
      .prepare('SELECT rowid, rank FROM ft_chunks WHERE ft_chunks MATCH ? ORDER BY rank LIMIT ?')
      .all(tokenizedQuery, k) as Array<{ rowid: number; rank: number }>
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
      return r
        ? [{ rowid: r.rowid, sourceDoc: r.source_doc, headingPath: r.heading_path, content: r.content }]
        : []
    })
  }

  /** docs = 有 chunk 数据的文档数(DISTINCT source_doc);登记表只反映同步进度,不作为计数来源。 */
  docCount(): { docs: number; chunks: number } {
    return this.db
      .prepare(
        'SELECT (SELECT COUNT(DISTINCT source_doc) FROM chunks) AS docs, (SELECT COUNT(*) FROM chunks) AS chunks',
      )
      .get() as { docs: number; chunks: number }
  }

  /** 释放 SQLite 与 Lance 双句柄(Windows 下必须 await 完成后再删目录,否则 EPERM)。
   *  先置 closed 栅栏再 await:close 期间抵达的 knn/upsert 立即响亮失败,而非重建连接。 */
  async close(): Promise<void> {
    this.closed = true
    const connPromise = this.lanceConn
    this.lanceConn = undefined
    this.lanceTablePromise = undefined
    const conn = await connPromise?.catch(() => undefined)
    await conn?.close?.()
    this.db.close()
  }
}
