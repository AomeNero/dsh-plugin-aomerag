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
