// 中文分词(spike B 定案):Intl.Segmenter('zh-CN', word) 预分词 + FTS5 unicode61。
// 入库与查询共用本函数,保证两侧行为一致。

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

/** 分词后空格 join(纯空白 segment 过滤)。中文按词切分,英文单词与标点原样保留。 */
export function tokenize(text: string): string {
  const tokens: string[] = []
  for (const { segment } of segmenter.segment(text)) {
    if (segment.trim().length > 0) tokens.push(segment)
  }
  return tokens.join(' ')
}

/** 查询侧专用:tokenize 后逐 token 双引号包裹为 FTS5 短语字面量(内部 " 转义为 ""),
 *  空格 join。标点与 AND/OR/NOT/NEAR 不再被解析为查询语法,含语法字符的自然查询
 *  不再整次检索抛错(审查 R5)。入库侧仍用 tokenize(其输出是数据,非语法)。
 *  返回空串表示查询无有效 token,调用方应短路。 */
export function toFtsMatchQuery(text: string): string {
  const tokens: string[] = []
  for (const { segment } of segmenter.segment(text)) {
    if (segment.trim().length > 0) tokens.push(`"${segment.replace(/"/g, '""')}"`)
  }
  return tokens.join(' ')
}
