// Spike A: better-sqlite3 + sqlite-vec 在 Windows/pnpm 下的加载与 KNN
// 结论模式: 显式 rowid 绑定有兼容 bug, 改用 "vec0 自动 rowid → 回填元数据表" 模式
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'

const log = (ok: boolean, label: string, extra = '') =>
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
let failed = 0
const check = (ok: boolean, label: string, extra = '') => { if (!ok) failed++; log(ok, label, extra) }

const db = new Database(':memory:')
check(true, 'better-sqlite3 原生绑定加载 (SQLite v' + (db.prepare('select sqlite_version() v').get() as any).v + ')')

sqliteVec.load(db)
const vecVer = (db.prepare('select vec_version() v').get() as any)?.v
check(!!vecVer, 'sqlite-vec 扩展加载', 'vec_version=' + vecVer)

// 模式: chunks(元数据, 主键对齐 vec rowid) + vec_chunks(向量)
db.exec(`
  CREATE TABLE chunks (
    rowid INTEGER PRIMARY KEY,
    source_doc TEXT NOT NULL,
    heading TEXT NOT NULL,
    content TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[8]);
`)

// 插入: vec0 自动分配 rowid → last_insert_rowid() → 回填 chunks
const insertChunk = db.prepare('INSERT INTO chunks(rowid, source_doc, heading, content) VALUES (?, ?, ?, ?)')
const insertVec = db.prepare('INSERT INTO vec_chunks(embedding) VALUES (?)')
const lastRowid = db.prepare('SELECT last_insert_rowid() AS id')
const toBuf = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength)

const docs: Array<[string, string, string, Float32Array]> = [
  ['gi328.md', '电源设计', 'GI328 电源模块 3.3V', new Float32Array([0.9, 0.1, 0, 0, 0, 0, 0, 0.1])],
  ['gi328.md', '接口', 'GI328 PINMAP 定义', new Float32Array([0.1, 0.9, 0, 0, 0, 0, 0, 0.1])],
  ['gi329.md', '电源设计', 'GI329 电源模块 5V', new Float32Array([0.95, 0.05, 0, 0, 0, 0, 0, 0])],
]
const insertTx = db.transaction(([doc, heading, text, vec]: [string, string, string, Float32Array]) => {
  insertVec.run(toBuf(vec))
  insertChunk.run((lastRowid.get() as any).id, doc, heading, text)
})
for (const d of docs) insertTx(d)
check(true, '插入 3 条 (vec 自动 rowid → 事务内回填元数据)')

// KNN: 查接近 [1,0,...] 的 → 应命中两块电源文档
const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0])
const knn = db.prepare(`
  SELECT c.source_doc, c.heading, t.distance
  FROM (SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT 2) t
  JOIN chunks c ON c.rowid = t.rowid
`)
const hits = knn.all(toBuf(query)) as any[]
check(hits.length === 2 && hits[0].source_doc === 'gi329.md' && hits[1].source_doc === 'gi328.md',
  'KNN MATCH + join 元数据 (距离排序正确)', JSON.stringify(hits))

// 级联删除 (先查 rowid 集合, 事务内删两表 — 幂等重灌语义)
const delByDoc = db.transaction((doc: string) => {
  const ids = (db.prepare('SELECT rowid FROM chunks WHERE source_doc = ?').all(doc) as any[]).map(r => r.rowid)
  const delVec = db.prepare('DELETE FROM vec_chunks WHERE rowid = ?')
  const delChunk = db.prepare('DELETE FROM chunks WHERE rowid = ?')
  for (const id of ids) { delVec.run(id); delChunk.run(id) }
})
delByDoc('gi328.md')
const remaining = (db.prepare('SELECT count(*) n FROM chunks').get() as any).n
const remainingVec = (db.prepare('SELECT count(*) n FROM vec_chunks').get() as any).n
check(remaining === 1 && remainingVec === 1, '按文档级联删除两表', `chunks=${remaining} vec=${remainingVec}`)

// 持久化验证: 文件库 + 重新打开数据还在
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(), 'aome-spike-'))
const file = join(dir, 'kb.sqlite')
const fdb = new Database(file)
sqliteVec.load(fdb)
fdb.exec(`
  CREATE TABLE chunks (rowid INTEGER PRIMARY KEY, content TEXT);
  CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[4]);
`)
fdb.prepare('INSERT INTO vec_chunks(embedding) VALUES (?)').run(toBuf(new Float32Array([1, 0, 0, 0])))
fdb.prepare('INSERT INTO chunks(rowid, content) VALUES (?, ?)').run((fdb.prepare('SELECT last_insert_rowid() i').get() as any).i, 'x')
fdb.close()
const fdb2 = new Database(file)
sqliteVec.load(fdb2)
const persistHit = fdb2.prepare(`
  SELECT c.content FROM (SELECT rowid FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT 1) t
  JOIN chunks c ON c.rowid = t.rowid
`).get(toBuf(new Float32Array([1, 0, 0, 0])))
check((persistHit as any)?.content === 'x', '文件库持久化 + 重开 + 扩展重加载', JSON.stringify(persistHit))
fdb2.close()

console.log(failed === 0 ? '\nSpike A 全部通过 ✅' : `\nSpike A 有 ${failed} 项失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
