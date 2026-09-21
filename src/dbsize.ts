// 库体积统计:SQLite 文件 + Lance 目录递归求和(审查 R22——Lance 主体在
// <name>.lance/data/ 子目录,顶层只计文件会数量级低估)。

import { readdirSync, statSync } from 'node:fs'
import { join, parse } from 'node:path'

export const lanceDirOf = (dbPath: string): string => {
  const p = parse(dbPath)
  return join(p.dir, `${p.name}.lance`)
}

/** 目录递归字节数;目录不存在或单项不可读时按 0 计(首灌前/竞态宽容)。 */
const dirBytes = (dir: string): number => {
  let total = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) total += dirBytes(abs)
    else {
      try {
        total += statSync(abs).size
      } catch {
        /* 单文件缺失跳过 */
      }
    }
  }
  return total
}

/** 单路径字节数:文件取 size,目录递归;不存在按 0。 */
const pathBytes = (path: string): number => {
  try {
    const st = statSync(path)
    return st.isFile() ? st.size : dirBytes(path)
  } catch {
    return 0
  }
}

/** 库体积(SQLite 文件 + Lance 目录,MB;一位小数)。 */
export const dbSizeMB = (dbPath: string): number => {
  const bytes = pathBytes(dbPath) + dirBytes(lanceDirOf(dbPath))
  return Math.round((bytes / 1e6) * 10) / 10
}
