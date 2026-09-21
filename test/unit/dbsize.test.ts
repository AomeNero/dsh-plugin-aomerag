import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dbSizeMB } from '../../src/dbsize.ts'

// 库体积统计(审查 R22):Lance 主体在 <name>.lance/data/ 子目录,
// 旧的顶层 readdir 只计文件,数量级低估;必须递归求和。

describe('dbSizeMB', () => {
  it('递归求和 SQLite 文件与 Lance data/ 子目录', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aomerag-dbsize-'))
    try {
      const buf = Buffer.alloc(600_000, 1)
      writeFileSync(join(dir, 'kb.sqlite'), buf) // 0.6 MB
      mkdirSync(join(dir, 'kb.lance', 'data'), { recursive: true })
      writeFileSync(join(dir, 'kb.lance', 'data', 'a.lance'), buf) // 0.6 MB(子目录内,旧实现漏计)
      writeFileSync(join(dir, 'kb.lance', 'manifest'), Buffer.alloc(300_000, 1)) // 0.3 MB
      expect(dbSizeMB(join(dir, 'kb.sqlite'))).toBe(1.5)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('库与 Lance 目录均不存在时返回 0(首灌前)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aomerag-dbsize-empty-'))
    try {
      expect(dbSizeMB(join(dir, 'none.sqlite'))).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
