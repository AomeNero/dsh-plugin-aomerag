import { describe, expect, it } from 'vitest'
import { chunkMarkdown } from '../../src/chunker.ts'

// 行为蓝本:AomeRAG ingestion/chunker.py —— 标题层级栈切分,超 max 的 section
// 按段落贪心累积(带 overlap 尾接),仍超的窗口按 target 步长硬切。

// 小尺寸参数便于精确构造;字符计数按 code point(对齐 Python len 语义)
const OPTS = { target: 50, max: 60, overlap: 10 }

describe('chunkMarkdown: 标题结构切分', () => {
  it('短文整篇一块,携带标题路径与序号', () => {
    const chunks = chunkMarkdown('# 电源模块\n\n输入电压范围 3.3V 至 5V。', OPTS)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({
      content: '输入电压范围 3.3V 至 5V。',
      headingPath: '电源模块',
      index: 0,
    })
  })

  it('嵌套标题组成路径,同级标题替换(栈弹出)', () => {
    const md = [
      '# A',
      '正文一',
      '',
      '## B',
      '正文二',
      '',
      '## C',
      '正文三',
    ].join('\n')
    const chunks = chunkMarkdown(md, OPTS)
    expect(chunks.map((c) => c.headingPath)).toEqual(['A', 'A > B', 'A > C'])
    expect(chunks.map((c) => c.content)).toEqual(['正文一', '正文二', '正文三'])
  })

  it('上层标题回归后路径不含已弹出标题', () => {
    const md = '# X\n## Y\n正文\n\n# Z\n正文'
    const chunks = chunkMarkdown(md, OPTS)
    expect(chunks.map((c) => c.headingPath)).toEqual(['X > Y', 'Z'])
  })

  it('标题前的无标题正文:headingPath 为空串', () => {
    const chunks = chunkMarkdown('前言文本\n\n# A\n正文', OPTS)
    expect(chunks[0].headingPath).toBe('')
    expect(chunks[0].content).toBe('前言文本')
    expect(chunks[1].headingPath).toBe('A')
  })

  it('标题行不进入正文内容', () => {
    const chunks = chunkMarkdown('# A\n正文', OPTS)
    expect(chunks[0].content).not.toContain('#')
    expect(chunks[0].content).not.toContain('A\n')
  })

  it('井号后无空格或超过 6 级不算标题', () => {
    const chunks = chunkMarkdown('#hashtag 正文\n\n####### 七级标题\n正文二', OPTS)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].headingPath).toBe('')
    expect(chunks[0].content).toContain('#hashtag 正文')
  })

  it('只有标题没有正文的文档产出 0 块', () => {
    expect(chunkMarkdown('# A\n## B', OPTS)).toEqual([])
  })

  it('空字符串产出 0 块', () => {
    expect(chunkMarkdown('', OPTS)).toEqual([])
  })

  it('多个 section 的 index 全局连续递增', () => {
    const md = '# A\n正文\n\n# B\n正文\n\n# C\n正文'
    expect(chunkMarkdown(md, OPTS).map((c) => c.index)).toEqual([0, 1, 2])
  })
})

describe('chunkMarkdown: 定长兜底', () => {
  const p1 = '一'.repeat(20)
  const p2 = '二'.repeat(20)
  const p3 = '三'.repeat(20)

  it('段落贪心累积到 target 结算,下一窗以 overlap 尾接开头', () => {
    // 三段各 20 字:窗口1 = p1+p2(42 ≤ 50),p3 触发结算;
    // 窗口2 = 窗口1 末尾 10 字 + p3
    const chunks = chunkMarkdown(`# T\n\n${p1}\n\n${p2}\n\n${p3}`, OPTS)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].content).toBe(`${p1}\n\n${p2}`)
    expect(chunks[1].content).toBe(`${'二'.repeat(10)}\n\n${p3}`)
    expect(chunks.every((c) => c.headingPath === 'T')).toBe(true)
  })

  it('overlap=0 时窗口之间无重叠', () => {
    const chunks = chunkMarkdown(`# T\n\n${p1}\n\n${p2}\n\n${p3}`, {
      ...OPTS,
      overlap: 0,
    })
    expect(chunks[1].content).toBe(p3)
  })

  it('单个超长段落按 target 步长硬切,拼接可还原', () => {
    const long = '甲'.repeat(130)
    const chunks = chunkMarkdown(`# T\n\n${long}`, OPTS)
    expect(chunks.map((c) => [...c.content].length)).toEqual([50, 50, 30])
    expect(chunks.map((c) => c.content).join('')).toBe(long)
  })

  it('硬切不切断代理对字符(emoji 完整)', () => {
    const emojis = '😀'.repeat(65) // 65 code points,130 UTF-16 units
    const chunks = chunkMarkdown(`# T\n\n${emojis}`, OPTS)
    expect(chunks).toHaveLength(2)
    for (const c of chunks) {
      expect([...c.content].every((ch) => ch === '😀')).toBe(true)
    }
    expect(chunks.map((c) => [...c.content].length)).toEqual([50, 15])
  })
})
