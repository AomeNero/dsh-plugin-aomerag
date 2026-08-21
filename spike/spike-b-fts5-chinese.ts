// Spike B: FTS5 中文检索三方案对比
// 对照组: unicode61 直接存中文 (预期失败)
// 方案1: trigram tokenizer
// 方案2: Intl.Segmenter 预分词 + unicode61 (查询同分词)
// 验收: 中文整句查询能命中正确文档、排序合理; 记录索引/查询行为差异
import Database from 'better-sqlite3'

const log = (ok: boolean, label: string, extra = '') =>
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
let failed = 0
const check = (ok: boolean, label: string, extra = '') => { if (!ok) failed++; log(ok, label, extra) }

// 中文语料 (模拟知识库): 三篇不同主题
const corpus: Array<[number, string]> = [
  [1, 'GI328 电源模块设计说明。输入电压范围 3.3V 至 5V，支持过流保护与软启动。'],
  [2, 'PG 图案发生器 Lua Recipe 开发指南。Recipe 由多个时序段组成，每段定义电平和持续时间。'],
  [3, '电测产品履历查询流程。输入产品序列号后系统返回测试记录与不良代码。'],
]

const queries: Array<[string, number, string]> = [
  // [查询, 期望命中文档id, 说明]
  ['电源模块 输入电压', 1, '词组命中'],
  ['Recipe 时序段', 2, '中英混合'],
  ['产品序列号', 3, '纯中文词'],
  ['过流保护', 1, '四字词'],
]

const db = new Database(':memory:')
console.log('SQLite FTS5 版本:', (db.prepare('select sqlite_version() v').get() as any).v)

// ---- 对照组: unicode61 直存中文 ----
db.exec(`CREATE VIRTUAL TABLE ft_ctrl USING fts5(content, tokenize='unicode61')`)
const insCtrl = db.prepare('INSERT INTO ft_ctrl(rowid, content) VALUES (?, ?)')
for (const [id, text] of corpus) insCtrl.run(id, text)
let ctrlHit = 0
for (const [q, expectId] of queries) {
  try {
    const r = db.prepare('SELECT rowid FROM ft_ctrl WHERE ft_ctrl MATCH ? ORDER BY rank LIMIT 1').get(q) as any
    if (r?.rowid === expectId) ctrlHit++
  } catch { /* 查询语法错也计入未命中 */ }
}
check(ctrlHit === 0, `对照组 unicode61 直存中文: ${ctrlHit}/4 命中 (预期 0, 证明中文直存失效)`)

// ---- 方案1: trigram ----
try {
  db.exec(`CREATE VIRTUAL TABLE ft_tri USING fts5(content, tokenize='trigram')`)
  const insTri = db.prepare('INSERT INTO ft_tri(rowid, content) VALUES (?, ?)')
  for (const [id, text] of corpus) insTri.run(id, text)
  let triHit = 0
  const triDetail: string[] = []
  for (const [q, expectId, note] of queries) {
    // trigram: 短语查询 (<3字符无法命中), 用双引号短语 + OR 连接词组
    try {
      const terms = q.split(/\s+/).map(t => `"${t}"`).join(' OR ')
      const r = db.prepare('SELECT rowid, rank FROM ft_tri WHERE ft_tri MATCH ? ORDER BY rank LIMIT 1').get(terms) as any
      const ok = r?.rowid === expectId
      if (ok) triHit++
      triDetail.push(`${note}:${ok ? '✓' : '✗(' + JSON.stringify(r) + ')'}`)
    } catch (e: any) { triDetail.push(`${note}:ERR(${e.message.slice(0, 40)})`) }
  }
  check(triHit === queries.length, `方案1 trigram: ${triHit}/4 命中`, triDetail.join(' '))
  // trigram 边界: 2字词无法命中 (如"电源"单查)
  const two = db.prepare(`SELECT rowid FROM ft_tri WHERE ft_tri MATCH '"电源"' LIMIT 1`).get()
  log(true, `trigram 2字词"电源"边界: ${two ? '能命中' : '不能命中(需≥3字符)'}`)
} catch (e: any) {
  check(false, '方案1 trigram 建表失败', e.message.slice(0, 60))
}

// ---- 方案2: Intl.Segmenter 预分词 + unicode61 ----
const seg = new Intl.Segmenter('zh-CN', { granularity: 'word' })
const tokenize = (text: string): string =>
  Array.from(seg.segment(text))
    .map(s => s.segment)
    .filter(s => s.trim().length > 0)
    .join(' ')
log(true, '分词示例: "电源模块设计说明" →', JSON.stringify(tokenize('电源模块设计说明')))

db.exec(`CREATE VIRTUAL TABLE ft_seg USING fts5(content, tokenize='unicode61')`)
const insSeg = db.prepare('INSERT INTO ft_seg(rowid, content) VALUES (?, ?)')
for (const [id, text] of corpus) insSeg.run(id, tokenize(text))
let segHit = 0
const segDetail: string[] = []
for (const [q, expectId, note] of queries) {
  // 查询同样分词后, 词组 AND (空格分隔 = 隐式 AND)
  try {
    const qTok = tokenize(q)
    const r = db.prepare('SELECT rowid, rank FROM ft_seg WHERE ft_seg MATCH ? ORDER BY rank LIMIT 1').get(qTok) as any
    const ok = r?.rowid === expectId
    if (ok) segHit++
    segDetail.push(`${note}:${ok ? '✓' : '✗(q=${qTok})'}`)
  } catch (e: any) { segDetail.push(`${note}:ERR(${e.message.slice(0, 40)})`) }
}
check(segHit === queries.length, `方案2 Segmenter+unicode61: ${segHit}/4 命中`, segDetail.join(' '))

// 2字词边界: "电源" 分词后仍可命中
const twoSeg = db.prepare(`SELECT rowid FROM ft_seg WHERE ft_seg MATCH ? LIMIT 1`).get(tokenize('电源')) as any
check(twoSeg?.rowid === 1, '方案2 2字词"电源"可命中', JSON.stringify(twoSeg))

// 性能参考: Segmenter 吞吐 (1万次分词)
const t0 = performance.now()
let n = 0
for (let i = 0; i < 10_000; i++) { n += tokenize(corpus[i % 3][1]).length }
log(true, `Segmenter 性能: 1万次短文本分词 ${Math.round(performance.now() - t0)}ms (len=${n})`)

db.close()
console.log(failed === 0 ? '\nSpike B 全部通过 ✅' : `\nSpike B 有 ${failed} 项失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
