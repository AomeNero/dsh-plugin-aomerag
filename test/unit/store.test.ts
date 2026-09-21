import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as lancedb from '@lancedb/lancedb'
import { KbStore } from '../../src/store.ts'
import { tokenize } from '../../src/tokenize.ts'
import type { Chunk } from '../../src/chunker.ts'

// 行为蓝本:spike A 两绕过模式(自动 rowid 回填 / 子查询 LIMIT)。
// FTS 中文方案:spike B(入库预分词,查询传已分词串)。

const DIM = 8

let store: KbStore
beforeEach(() => {
  store = KbStore.open(':memory:', { dim: DIM })
})
afterEach(async () => {
  await store.close()
})

const chunk = (content: string, headingPath = 'H'): Chunk => ({ content, headingPath, index: 0 })
const vec = (...xs: number[]): Float32Array =>
  Float32Array.from([...xs, ...Array<number>(DIM - xs.length).fill(0)])

describe('KbStore: 建表与空库', () => {
  it('空库计数为零,knn/fts 返回空数组', async () => {
    expect(store.docCount()).toEqual({ docs: 0, chunks: 0 })
    expect(await store.knn(vec(1), 5)).toEqual([])
    expect(store.fts(tokenize('电源'), 5)).toEqual([])
  })
})

describe('KbStore: upsertDoc 与 chunkMeta', () => {
  it('写入向量/元数据/FTS,docCount 正确', async () => {
    await store.upsertDoc('a.md', [chunk('第一块', 'A'), chunk('第二块', 'B')], [vec(1), vec(0, 1)])
    expect(store.docCount()).toEqual({ docs: 1, chunks: 2 })
  })

  it('chunkMeta 按输入 rowid 顺序返回元数据(含 rowid 供融合对齐)', async () => {
    await store.upsertDoc('a.md', [chunk('第一块', 'A'), chunk('第二块', 'B')], [vec(1), vec(0, 1)])
    const ids = (await store.knn(vec(1), 2)).map((h) => h.rowid)
    const metas = store.chunkMeta([...ids].reverse())
    expect(metas.map((m) => m.rowid)).toEqual([...ids].reverse())
    expect(metas[0]!.headingPath).toBe('B')
    expect(metas[1]!.headingPath).toBe('A')
    expect(metas.every((m) => m.sourceDoc === 'a.md')).toBe(true)
  })

  it('跳过不存在的 rowid(并发同步删除场景的宽容行为)', async () => {
    await store.upsertDoc('a.md', [chunk('x')], [vec(1)])
    const id = (await store.knn(vec(1), 1))[0]!.rowid
    const metas = store.chunkMeta([id, id + 999])
    expect(metas).toHaveLength(1)
    expect(metas[0]!.content).toBe('x')
  })

  it('chunks 与 vectors 数量不符时抛错', async () => {
    await expect(store.upsertDoc('a.md', [chunk('x')], [])).rejects.toThrow()
  })

  it('空块列表的 upsertDoc 等于清空该文档', async () => {
    await store.upsertDoc('a.md', [chunk('x'), chunk('y')], [vec(1), vec(0, 1)])
    await store.upsertDoc('a.md', [], [])
    expect(store.docCount()).toEqual({ docs: 0, chunks: 0 })
  })
})

describe('KbStore: KNN', () => {
  it('按距离升序返回并受 k 截断', async () => {
    await store.upsertDoc(
      'docs.md',
      [chunk('近'), chunk('中'), chunk('远')],
      [vec(0.95), vec(0.9), vec(0.1)],
    )
    const hits = await store.knn(vec(1), 2)
    expect(hits).toHaveLength(2)
    expect(hits[0]!.distance).toBeLessThan(hits[1]!.distance)
    const contents = hits.map((h) => store.chunkMeta([h.rowid])[0]!.content)
    expect(contents).toEqual(['近', '中'])
  })
})

describe('KbStore: FTS 中文', () => {
  it('中文查询命中正确文档(spike B 方案)', async () => {
    await store.upsertDoc(
      'power.md',
      [chunk('GI328 电源模块设计说明。输入电压范围 3.3V 至 5V。', '电源')],
      [vec(1)],
    )
    await store.upsertDoc(
      'recipe.md',
      [chunk('PG 图案发生器 Lua Recipe 开发指南。Recipe 由多个时序段组成。', 'Recipe')],
      [vec(0, 1)],
    )
    const hits = store.fts(tokenize('电源模块 输入电压'), 5)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(store.chunkMeta(hits.map((h) => h.rowid))[0]!.sourceDoc).toBe('power.md')
  })

  it('rank 升序且受 k 截断', async () => {
    await store.upsertDoc('m.md', [chunk('电源 电源 电源 电源'), chunk('电源')], [vec(1), vec(1)])
    const all = store.fts(tokenize('电源'), 10)
    expect(all.length).toBe(2)
    expect(all[0]!.rank).toBeLessThanOrEqual(all[1]!.rank)
    expect(store.fts(tokenize('电源'), 1)).toHaveLength(1)
  })
})

describe('KbStore: 删除与幂等', () => {
  it('deleteDoc 清空向量/元数据/FTS 三表', async () => {
    await store.upsertDoc('a.md', [chunk('电源内容'), chunk('别的')], [vec(1), vec(0, 1)])
    await store.deleteDoc('a.md')
    expect(store.docCount()).toEqual({ docs: 0, chunks: 0 })
    expect(await store.knn(vec(1), 5)).toEqual([])
    expect(store.fts(tokenize('电源'), 5)).toEqual([])
  })

  it('同一文档重复 upsert 先删后插,无残留', async () => {
    await store.upsertDoc(
      'a.md',
      [chunk('旧一'), chunk('旧二'), chunk('旧三')],
      [vec(1), vec(0, 1), vec(0, 0, 1)],
    )
    await store.upsertDoc('a.md', [chunk('新一')], [vec(1)])
    expect(store.docCount()).toEqual({ docs: 1, chunks: 1 })
    expect(store.chunkMeta((await store.knn(vec(1), 10)).map((h) => h.rowid))[0]!.content).toBe('新一')
    expect(store.fts(tokenize('旧一'), 10)).toEqual([]) // 旧 FTS 已随先删清理
  })
})

describe('KbStore: fileRegistry', () => {
  it('未登记的 docId 返回 undefined', async () => {
    expect(store.fileRegistry.get('nope.md')).toBeUndefined()
  })

  it('set 后可 get,重复 set 覆盖', async () => {
    store.fileRegistry.set('a.md', 'sha1')
    expect(store.fileRegistry.get('a.md')).toEqual({ sha: 'sha1' })
    store.fileRegistry.set('a.md', 'sha2')
    expect(store.fileRegistry.get('a.md')).toEqual({ sha: 'sha2' })
  })

  it('prune 只保留 valid 集合内的登记', async () => {
    store.fileRegistry.set('a.md', '1')
    store.fileRegistry.set('b.md', '2')
    store.fileRegistry.set('c.md', '3')
    store.fileRegistry.prune(['a.md', 'c.md'])
    expect(store.fileRegistry.get('b.md')).toBeUndefined()
    expect(store.fileRegistry.get('a.md')).toEqual({ sha: '1' })
  })

  it('prune([]) 清空全部登记', async () => {
    store.fileRegistry.set('a.md', '1')
    store.fileRegistry.prune([])
    expect(store.fileRegistry.get('a.md')).toBeUndefined()
  })

  it('keys 枚举全部登记(供同步引擎做删除清理)', async () => {
    expect(store.fileRegistry.keys()).toEqual([])
    store.fileRegistry.set('b.md', '2')
    store.fileRegistry.set('a.md', '1')
    expect(store.fileRegistry.keys().sort()).toEqual(['a.md', 'b.md'])
    store.fileRegistry.prune(['a.md'])
    expect(store.fileRegistry.keys()).toEqual(['a.md'])
  })
})

describe('KbStore: 持久化', () => {
  it('文件库重开:数据仍在,vec0 扩展重载,knn/fts 可用', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aomerag-store-'))
    try {
      const file = join(dir, 'sub', 'kb.sqlite') // 嵌套目录自动创建
      const s1 = KbStore.open(file, { dim: DIM })
      await s1.upsertDoc('a.md', [chunk('GI328 电源模块设计说明')], [vec(1)])
      s1.fileRegistry.set('a.md', 'sha-x')
      await s1.close()

      const s2 = KbStore.open(file, { dim: DIM })
      expect(s2.docCount()).toEqual({ docs: 1, chunks: 1 })
      expect(await s2.knn(vec(1), 1)).toHaveLength(1)
      const ftsIds = s2.fts(tokenize('电源模块'), 5).map((h) => h.rowid)
      expect(s2.chunkMeta(ftsIds)[0]!.sourceDoc).toBe('a.md')
      expect(s2.fileRegistry.get('a.md')).toEqual({ sha: 'sha-x' })
      await s2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('KbStore: 关闭栅栏(审查 R8)', () => {
  it('close 后 knn/upsertDoc/deleteDoc 响亮拒绝,不再经 ??= 重建 Lance 连接泄漏句柄', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aomerag-store-close-'))
    const s = KbStore.open(join(dir, 'kb.sqlite'), { dim: DIM })
    try {
      await s.upsertDoc('a.md', [chunk('存活块')], [vec(1)])
      await s.close()
      // dispose 窗口内 in-flight 检索走到 lanceTable():旧实现 ??= 新建连接且永不关闭
      await expect(s.knn(vec(1), 1)).rejects.toThrow(/已关闭/)
      await expect(s.upsertDoc('a.md', [chunk('y')], [vec(1)])).rejects.toThrow()
      await expect(s.deleteDoc('a.md')).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('KbStore: gcOrphans(审查 R7)', () => {
  it('清除 Lance 中不在 SQLite 行集内的孤儿向量,返回清除数', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aomerag-store-gc-'))
    try {
      // 崩溃窗口模拟:SQLite 已提交、Lance 残留孤儿 → 进程退出
      const s1 = KbStore.open(join(dir, 'kb.sqlite'), { dim: DIM })
      await s1.upsertDoc('a.md', [chunk('存活块')], [vec(1)])
      await s1.close()
      const conn = await lancedb.connect(join(dir, 'kb.lance'))
      const table = await conn.openTable('vec_chunks')
      await table.add([{ id: 99999, vector: vec(2) }])
      await conn.close()

      // 重启后:孤儿对全新连接可见且占据召回
      const s2 = KbStore.open(join(dir, 'kb.sqlite'), { dim: DIM })
      try {
        const before = (await s2.knn(vec(2), 5)).map((r) => r.rowid)
        expect(before).toContain(99999)

        expect(await s2.gcOrphans()).toBe(1)
        const after = (await s2.knn(vec(2), 5)).map((r) => r.rowid)
        expect(after).not.toContain(99999)
        expect(after).toContain(1) // 存活数据不受影响
      } finally {
        await s2.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('无孤儿时返回 0', async () => {
    expect(await store.gcOrphans()).toBe(0)
  })
})

describe('KbStore: meta 表(审查 R18 embedding 模型指纹)', () => {
  it('setMeta/getMeta 往返;未设置返回 undefined', () => {
    expect(store.getMeta('embedModel')).toBeUndefined()
    store.setMeta('embedModel', 'bge-m3')
    expect(store.getMeta('embedModel')).toBe('bge-m3')
    store.setMeta('embedModel', 'qwen3-embedding')
    expect(store.getMeta('embedModel')).toBe('qwen3-embedding') // 覆盖
  })

  it('文件库重开后 meta 持久', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aomerag-store-meta-'))
    const s1 = KbStore.open(join(dir, 'kb.sqlite'), { dim: DIM })
    try {
      s1.setMeta('embedModel', 'bge-m3')
      await s1.close()
      const s2 = KbStore.open(join(dir, 'kb.sqlite'), { dim: DIM })
      expect(s2.getMeta('embedModel')).toBe('bge-m3')
      await s2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
