import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KbStore } from '../../src/store.ts'
import { tokenize } from '../../src/tokenize.ts'
import type { EmbedsTexts } from '../../src/sync.ts'

// 行为蓝本:AomeRAG incremental_ingest——递归扫描 .md、sha1 字节哈希对比、
// 失败文件不登记(下次重试)、已删文件清数据。fixture:临时目录 + mock embedder。

const OPTS = { target: 50, max: 60, overlap: 10, batchSize: 64 }

let dir: string
let store: KbStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aomerag-sync-'))
  store = KbStore.open(':memory:', { dim: 4 })
})
afterEach(async () => {
  await store.close()
  rmSync(dir, { recursive: true, force: true })
})

const write = (rel: string, content: string): void => {
  const abs = join(dir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

/** 确定性 mock 向量:内容长度映射到 4 维,便于验证 upsert 对齐 */
const makeEmbedder = (behavior?: {
  failOnceOn?: string
  failAlwaysOn?: string
}): EmbedsTexts & { calls: number; batches: string[][] } => {
  const state = { calls: 0, batches: [] as string[][], retried: new Set<string>() }
  return {
    async embed(texts: string[]): Promise<Float32Array[]> {
      state.calls++
      state.batches.push(texts)
      const key = texts.join(' ')
      if (behavior?.failAlwaysOn && texts.includes(behavior.failAlwaysOn)) {
        throw new Error('mock: 模型离线')
      }
      if (
        behavior?.failOnceOn &&
        texts.includes(behavior.failOnceOn) &&
        !state.retried.has(key)
      ) {
        state.retried.add(key)
        throw new Error('mock: 瞬时网络错误')
      }
      return texts.map((t) => Float32Array.from([t.length % 8, 1, 0, 0]))
    },
    get calls() {
      return state.calls
    },
    get batches() {
      return state.batches
    },
  }
}

describe('syncDir: 首灌', () => {
  it('递归索引全部 md(含子目录),报告 added,登记 sha', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    write('power.md', '# 电源\n\nGI328 电源模块设计说明。')
    write('guide/recipe.md', '# Recipe\n\n时序段组成。')
    write('note.txt', '不是 md')
    const emb = makeEmbedder()
    const report = await syncDir({ store, embedder: emb }, dir, OPTS)
    expect(report).toEqual({
      added: 2,
      updated: 0,
      skipped: 0,
      removed: 0,
      failed: 0,
      errors: [],
    })
    expect(store.docCount()).toEqual({ docs: 2, chunks: 2 })
    expect(store.fileRegistry.get('power.md')).toBeDefined()
    expect(store.fileRegistry.get('guide/recipe.md')).toBeDefined() // posix 相对路径
  })

  it('中文文件名与中文内容正常入库', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    write('规格/电源模块.md', '# 电源\n\n输入电压范围 3.3V 至 5V。')
    const report = await syncDir({ store, embedder: makeEmbedder() }, dir, OPTS)
    expect(report.added).toBe(1)
    const ids = store.fts(tokenize('输入电压'), 5).map((h) => h.rowid)
    expect(store.chunkMeta(ids)[0]!.sourceDoc).toBe('规格/电源模块.md')
  })

  it('空 md 文件:计入 added,登记 sha,0 chunk', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    write('empty.md', '')
    const report = await syncDir({ store, embedder: makeEmbedder() }, dir, OPTS)
    expect(report.added).toBe(1)
    expect(store.docCount()).toEqual({ docs: 0, chunks: 0 })
    expect(store.fileRegistry.get('empty.md')).toBeDefined()
  })

  it('跳过 ~ 开头临时文件与 images/ 目录(蓝本约定)', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    write('~$temp.md', '临时')
    write('images/pic.md', '清洗产物')
    const report = await syncDir({ store, embedder: makeEmbedder() }, dir, OPTS)
    expect(report.added).toBe(0)
    expect(store.fileRegistry.keys()).toEqual([])
  })
})

describe('syncDir: 增量', () => {
  it('未变文件跳过且不产生 embedding 调用', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    write('a.md', '# A\n\n稳定内容')
    const emb = makeEmbedder()
    await syncDir({ store, embedder: emb }, dir, OPTS)
    const callsAfterFirst = emb.calls
    const report = await syncDir({ store, embedder: emb }, dir, OPTS)
    expect(report.skipped).toBe(1)
    expect(report.added).toBe(0)
    expect(emb.calls).toBe(callsAfterFirst) // 第二次零 embedding 调用
  })

  it('变更文件按 updated 计,旧内容被替换', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    write('a.md', '# A\n\n旧内容电源')
    write('b.md', '# B\n\n稳定')
    await syncDir({ store, embedder: makeEmbedder() }, dir, OPTS)
    write('a.md', '# A\n\n全新内容 Recipe')
    const report = await syncDir({ store, embedder: makeEmbedder() }, dir, OPTS)
    expect(report.updated).toBe(1)
    expect(report.skipped).toBe(1)
    expect(store.fts(tokenize('旧内容'), 10).length).toBe(0)
    expect(store.fts(tokenize('Recipe'), 10)[0]!.rowid).toBeDefined()
  })

  it('已删除文件:清数据与登记,计 removed', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    write('a.md', '# A\n\n内容')
    write('b.md', '# B\n\n内容')
    await syncDir({ store, embedder: makeEmbedder() }, dir, OPTS)
    rmSync(join(dir, 'a.md'))
    const report = await syncDir({ store, embedder: makeEmbedder() }, dir, OPTS)
    expect(report.removed).toBe(1)
    expect(report.skipped).toBe(1)
    expect(store.docCount()).toEqual({ docs: 1, chunks: 1 })
    expect(store.fileRegistry.keys()).toEqual(['b.md'])
  })
})

describe('syncDir: 容错', () => {
  it('embed 失败的文件计入 failed 不中断,其余文件正常;失败不登记下次重试', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    write('good.md', '# 好\n\n正常内容')
    write('bad.md', '# 坏\n\n触发失败的内容')
    const emb = makeEmbedder({ failAlwaysOn: '触发失败的内容' })
    const report = await syncDir({ store, embedder: emb }, dir, OPTS)
    expect(report.failed).toBe(1)
    expect(report.added).toBe(1)
    expect(report.errors[0]).toContain('bad.md')
    expect(store.fileRegistry.get('bad.md')).toBeUndefined() // 失败不登记 → 下次重试
    expect(store.fileRegistry.keys()).toEqual(['good.md'])
  })

  it('瞬时失败重试一次后成功不计 failed', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    write('a.md', '# A\n\n瞬时抖动内容')
    const emb = makeEmbedder({ failOnceOn: '瞬时抖动内容' })
    const report = await syncDir({ store, embedder: emb }, dir, OPTS)
    expect(report).toMatchObject({ added: 1, failed: 0, errors: [] })
    expect(store.docCount().chunks).toBe(1)
  })

  it('知识目录不存在:响亮抛错', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    await expect(
      syncDir({ store, embedder: makeEmbedder() }, join(dir, 'nope'), OPTS),
    ).rejects.toThrow(/不存在/)
  })
})

describe('syncDir: force 重建语义(审查 R4)', () => {
  it('force 对已登记未变文件强制重切重嵌,计 updated 而非 skipped', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    write('a.md', '# A\n\n稳定内容')
    await syncDir({ store, embedder: makeEmbedder() }, dir, OPTS)
    const emb = makeEmbedder()
    const report = await syncDir({ store, embedder: emb }, dir, { ...OPTS, force: true })
    expect(report.updated).toBe(1)
    expect(report.skipped).toBe(0)
    expect(emb.calls).toBeGreaterThan(0) // 确实重嵌了
  })

  it('force 保留登记行:已从磁盘删除的文件仍被清理循环移除(此前 prune([]) 使其永久孤儿)', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    write('a.md', '# A\n\n内容一')
    write('b.md', '# B\n\n内容二')
    await syncDir({ store, embedder: makeEmbedder() }, dir, OPTS)
    rmSync(join(dir, 'b.md'))
    const report = await syncDir({ store, embedder: makeEmbedder() }, dir, { ...OPTS, force: true })
    expect(report.removed).toBe(1)
    expect(report.updated).toBe(1)
    expect(store.docCount()).toEqual({ docs: 1, chunks: 1 })
    expect(store.fileRegistry.keys()).toEqual(['a.md'])
  })
})

describe('syncDir: overlap 跨字段钳制(审查 R19)', () => {
  const PARAS = Array.from({ length: 20 }, (_, i) => `第${i}段内容甲乙丙丁`).join('\n\n')

  it('overlap ≥ target 被钳到 target-1:与显式 overlap=target-1 产出完全一致', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    // 基线:显式 target-1
    write('x.md', `# X\n\n${PARAS}`)
    await syncDir({ store, embedder: makeEmbedder() }, dir, { ...OPTS, overlap: 49 })

    const dirB = mkdtempSync(join(tmpdir(), 'aomerag-sync-b-'))
    const storeB = KbStore.open(':memory:', { dim: 4 })
    try {
      writeFileSync(join(dirB, 'x.md'), `# X\n\n${PARAS}`, 'utf8')
      // 钳制前此值使窗口退化为全前缀复制(O(n²) 膨胀、近重复挤占召回)
      await syncDir({ store: storeB, embedder: makeEmbedder() }, dirB, { ...OPTS, overlap: 10_000 })
      expect(storeB.docCount().chunks).toBe(store.docCount().chunks)
    } finally {
      await storeB.close()
      rmSync(dirB, { recursive: true, force: true })
    }
  })
})

describe('syncDir: 分批', () => {
  it('超过 batchSize 的 chunk 拆成多批串行请求', async () => {
    const { syncDir } = await import('../../src/sync.ts')
    // 一个 section 130 字 → 3 chunks(target 50);batchSize=2 → 2 批
    write('long.md', `# 长文\n\n${'甲'.repeat(130)}`)
    const emb = makeEmbedder()
    await syncDir({ store, embedder: emb }, dir, { ...OPTS, batchSize: 2 })
    expect(emb.batches.map((b) => b.length)).toEqual([2, 1])
    expect(store.docCount().chunks).toBe(3)
  })
})
