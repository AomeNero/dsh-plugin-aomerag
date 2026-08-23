// 一次性迁移:旧库(vec0 虚拟表)的向量 → LanceDB 目录(A 方案)。
// 用法:node spike/migrate-to-lancedb.ts [sqlitePath]
// 目标 Lance 目录 = <同名去扩展名>.lance(KbStore 的派生规则)。
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import * as lancedb from '@lancedb/lancedb'
import { parse, join } from 'node:path'

const sqlitePath = process.argv[2] ?? 'data/acceptance.sqlite'
const p = parse(sqlitePath)
const lanceDir = join(p.dir, `${p.name}.lance`)

const db = new Database(sqlitePath)
sqliteVec.load(db) // 读 vec0 虚拟表需要扩展

const rows = db.prepare('SELECT rowid, embedding FROM vec_chunks').all() as Array<{
  rowid: number
  embedding: Buffer
}>
console.log(`旧库向量数: ${rows.length}`)

if (rows.length === 0) {
  console.log('无可迁移数据')
  db.close()
  process.exit(0)
}

const toVector = (buf: Buffer): Float32Array =>
  new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)

// 分批写入(每批 1000,首批判 schema)
const conn = await lancedb.connect(lanceDir)
const BATCH = 1000
let table: lancedb.Table | undefined
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH).map((r) => ({ id: r.rowid, vector: toVector(r.embedding) }))
  if (table === undefined) {
    table = await conn.createTable('vec_chunks', batch, { mode: 'overwrite' })
  } else {
    await table.add(batch)
  }
}
await conn.close()
db.close()
console.log(`✅ 已写入 ${lanceDir}(${rows.length} 条)`)

// 抽验:重开查一条
const conn2 = await lancedb.connect(lanceDir)
const t2 = await conn2.openTable('vec_chunks')
const sample = rows[0]!
const hits = await t2.search(toVector(sample.embedding)).limit(1).toArray()
const ok = hits[0]?.id === sample.rowid
await conn2.close()
console.log(ok ? '✅ 抽验通过(自身 rowid 最近)' : `❌ 抽验异常: 期望 ${sample.rowid} 实得 ${hits[0]?.id}`)
process.exit(ok ? 0 : 1)
