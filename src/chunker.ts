// 结构化优先切分器(蓝本:AomeRAG ingestion/chunker.py):
// 按 Markdown 标题层级栈切分;超过 max 的 section 走定长兜底 ——
// 段落贪心累积到 target 结算(下一窗以 overlap 尾接开头),仍超 max 的窗口按 target 步长硬切。
// 字符计数与切片均按 code point(对齐 Python len 语义,代理对不被切断)。

export interface Chunk {
  content: string
  headingPath: string
  index: number
}

export interface ChunkOptions {
  target: number
  max: number
  overlap: number
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/

/** 标题层级栈遍历,产出 [headingPath, 正文] 序列;标题行本身不进正文。 */
function sections(markdown: string): Array<[string, string]> {
  const result: Array<[string, string]> = []
  const stack: Array<{ level: number; title: string }> = []
  let buf: string[] = []

  const flush = (): void => {
    const body = buf.join('').trim()
    if (body) result.push([stack.map((s) => s.title).join(' > '), body])
    buf = []
  }

  for (const line of markdown.split(/\r?\n/)) {
    const m = HEADING_RE.exec(line)
    if (m) {
      flush()
      const level = m[1] ? m[1].length : 0
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
      stack.push({ level, title: m[2]! })
    } else {
      buf.push(`${line}\n`)
    }
  }
  flush()
  return result
}

/** 贪心按段落累积窗口(带重叠);超出 max 的窗口强制按 target 步长硬切。 */
function fixedWindows(text: string, opts: ChunkOptions): string[] {
  const paras = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0)
  const windows: string[] = []
  let cur = ''
  for (const p of paras) {
    if (!cur) {
      cur = p
    } else if ([...cur].length + [...p].length + 2 <= opts.target) {
      cur = `${cur}\n\n${p}`
    } else {
      windows.push(cur)
      const tail =
        opts.overlap > 0 ? [...cur].slice(-opts.overlap).join('') : ''
      cur = tail ? `${tail}\n\n${p}`.trim() : p
    }
  }
  if (cur.trim()) windows.push(cur)

  const final: string[] = []
  for (const w of windows) {
    const cps = [...w]
    if (cps.length <= opts.max) {
      final.push(w)
    } else {
      for (let i = 0; i < cps.length; i += opts.target) {
        final.push(cps.slice(i, i + opts.target).join(''))
      }
    }
  }
  return final
}

export function chunkMarkdown(markdown: string, opts: ChunkOptions): Chunk[] {
  const pieces: Array<[string, string]> = []
  for (const [headingPath, text] of sections(markdown)) {
    if ([...text].length <= opts.max) {
      pieces.push([headingPath, text])
    } else {
      for (const window of fixedWindows(text, opts)) pieces.push([headingPath, window])
    }
  }
  return pieces.map(([headingPath, content], index) => ({ content, headingPath, index }))
}
