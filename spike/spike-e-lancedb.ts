// Spike E: LanceDB 在 Node 24/Windows 的核心链路验证(A 方案:只做向量索引)
// 验证:目录连接/建表加数据/向量 KNN/按过滤删除/持久化重开/Float32 数组向量
import * as lancedb from '@lancedb/lancedb'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const log = (ok: boolean, label: string, extra = '') =>
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
let failed = 0
const check = (ok: boolean, label: string, extra = '') => {
  if (!ok) failed++
  log(ok, label, extra)
}

const dir = mkdtempSync(join(tmpdir(), 'aome-spike-e-'))
const DIM = 8

// 1. 连接 + 建表 + 批量插入(id = 我们将用的 SQLite rowid 映射)
const db = await lancedb.connect(dir)
const table = await db.createTable('vec_chunks', [
  { id: 1, vector: Float32Array.from([0.9, 0.1, 0, 0, 0, 0, 0, 0.1]) },
  { id: 2, vector: Float32Array.from([0.1, 0.9, 0, 0, 0, 0, 0, 0.1]) },
  { id: 3, vector: Float32Array.from([0.95, 0.05, 0, 0, 0, 0, 0, 0]) },
])
check(true, '连接 + 建表 + 插入(id + Float32Array 向量)')

// 2. 向量 KNN(默认暴力扫描,limit 生效)
const q = Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0])
const hits = await table.search(q).limit(2).toArray()
check(
  hits.length === 2 && hits[0].id === 3 && hits[1].id === 1,
  'KNN 按距离序返回并受 limit 截断',
  JSON.stringify(hits.map((h) => ({ id: h.id, d: Number(h._distance).toFixed(4) }))),
)

// 3. 按过滤删除(id 列表——重灌语义:先删同 doc 旧向量)
await table.delete('id IN (1, 2)')
const after = await table.search(q).limit(10).toArray()
check(after.length === 1 && after[0].id === 3, '按 id 过滤删除', `剩余 ${after.length} 条`)

// 4. 追加(变更重灌)
await table.add([{ id: 4, vector: Float32Array.from([0.9, 0, 0, 0, 0, 0, 0, 0]) }])
check((await table.search(q).limit(10).toArray()).length === 2, '追加新向量')

// 5. 持久化重开(库文件跨进程存活)
await db.close()
const db2 = await lancedb.connect(dir)
const t2 = await db2.openTable('vec_chunks')
const persist = await t2.search(q).limit(10).toArray()
check(persist.length === 2, '目录持久化 + 重开可查', `剩余 ${persist.length} 条`)
await db2.close()

rmSync(dir, { recursive: true, force: true })
console.log(failed === 0 ? '\nSpike E 全部通过 ✅' : `\nSpike E 有 ${failed} 项失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
