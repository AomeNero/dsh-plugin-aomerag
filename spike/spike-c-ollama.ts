// Spike C: Ollama bge-m3 embedding 真机验证
// 验证: 1) 新旧 embeddings API 2) bge-m3 维度 (预期 1024) 3) 批量接口 4) 中文语义相似性 5) 错误响应格式
const BASE = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'

const log = (ok: boolean, label: string, extra = '') =>
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
let failed = 0
const check = (ok: boolean, label: string, extra = '') => { if (!ok) failed++; log(ok, label, extra) }

// 0. 服务在线
const tags = await fetch(`${BASE}/api/tags`).then(r => r.json()).catch(() => null)
if (!tags) {
  console.log('❌ Ollama 未运行:', BASE)
  process.exit(1)
}
const models: string[] = (tags.models ?? []).map((m: any) => m.name)
log(models.some(m => m.startsWith('bge-m3')), 'Ollama 在线, bge-m3 已拉取', models.join(', ') || '(无模型)')

// 1. 旧 API /api/embeddings (AomeRAG 使用的方式)
const r1 = await fetch(`${BASE}/api/embeddings`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'bge-m3', prompt: '电源模块设计' }),
}).then(r => r.json()).catch(e => ({ error: String(e) }))
check(Array.isArray(r1?.embedding) && r1.embedding.length === 1024,
  `旧 API /api/embeddings 维度=${Array.isArray(r1?.embedding) ? r1.embedding.length : 'N/A'}`)

// 2. 新 API /api/embed (支持批量)
const r2 = await fetch(`${BASE}/api/embed`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'bge-m3', input: ['电源模块设计', 'Lua Recipe 时序段', 'power supply design'] }),
}).then(r => r.json()).catch(e => ({ error: String(e) }))
const embeds: number[][] = r2?.embeddings ?? []
check(embeds.length === 3 && embeds.every(e => e.length === 1024),
  `新 API /api/embed 批量 3 条, 每条维度=${embeds[0]?.length ?? 'N/A'}`)

// 3. 中文语义相似性: 电源相关 vs Recipe 相关
if (embeds.length === 3) {
  const cos = (a: number[], b: number[]) => {
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2 }
    return dot / (Math.sqrt(na) * Math.sqrt(nb))
  }
  const powerZh = embeds[0], recipeZh = embeds[1], powerEn = embeds[2]
  check(cos(powerZh, powerEn) > cos(powerZh, recipeZh),
    `语义相似性: 电源(中)↔power(英)=${cos(powerZh, powerEn).toFixed(3)} > 电源(中)↔Recipe(中)=${cos(powerZh, recipeZh).toFixed(3)}`)
}

// 4. 性能参考: 20 条短文本批量耗时
const t0 = performance.now()
const perf = await fetch(`${BASE}/api/embed`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'bge-m3', input: Array.from({ length: 20 }, (_, i) => `测试文本第${i}条`) }),
}).then(r => r.json()).catch(() => null)
log(true, `批量 20 条耗时 ${Math.round(performance.now() - t0)}ms (${perf?.embeddings?.length ?? 0} 条返回)`)

// 5. 错误响应格式 (模型不存在)
const err = await fetch(`${BASE}/api/embed`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'not-exist-model', input: ['x'] }),
})
const errBody = await err.text()
log(err.status === 404 && errBody.includes('error'), `错误响应: HTTP ${err.status}`, errBody.slice(0, 80))

console.log(failed === 0 ? '\nSpike C 全部通过 ✅' : `\nSpike C 有 ${failed} 项失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
