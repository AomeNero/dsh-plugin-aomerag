import { describe, expect, it } from 'vitest'
import { LIMITS, TunableSchema } from '../../src/tunable.ts'

// 参数闸门(审查 R1/R2/R13/R19/R24):0 与无界值曾使同步挂死/崩溃/占位符击穿。
// settings 层 schema 对全部输入做「钳制转换」而非拒绝——历史脏值(修复前持久化的
// 0/超大值)在注册解析时自动收敛到安全区间,不会炸掉 settings 注册(cordis 静默
// logger 下不可见);cordis 层 Config 则严格拒绝(部署错误加载期响亮失败,见 config.test)。

describe('TunableSchema 数值钳制', () => {
  it('默认值全部合法且与 AomeRAG 对齐', () => {
    expect(TunableSchema({})).toMatchObject({
      chunkTarget: 1200,
      chunkMax: 1600,
      chunkOverlap: 200,
      topK: 6,
      rrfK: 60,
      embedBatchSize: 64,
      syncOnStart: true,
    })
  })

  it('历史脏值 0 / 超大值钳制到边界(自愈,不抛)', () => {
    expect(TunableSchema({ embedBatchSize: 0 }).embedBatchSize).toBe(1)
    expect(TunableSchema({ chunkTarget: 0 }).chunkTarget).toBe(LIMITS.chunkTarget[0])
    expect(TunableSchema({ topK: 1e9 }).topK).toBe(LIMITS.topK[1])
    expect(TunableSchema({ embedBatchSize: 1e6 }).embedBatchSize).toBe(LIMITS.embedBatchSize[1])
    expect(TunableSchema({ chunkOverlap: 1e9 }).chunkOverlap).toBe(LIMITS.chunkOverlap[1])
  })

  it('垃圾输入(字符串/负数/null)收敛而非抛出——register 解析永不离线', () => {
    // 垃圾值只能来自 yaml 直改/旧版本落盘,TS 类型上不可表达,经 Record 越过字段类型
    const raw = (v: Record<string, unknown>) => TunableSchema(v as never)
    expect(raw({ topK: '30' }).topK).toBe(30)
    expect(raw({ topK: -5 }).topK).toBe(1)
    expect(raw({ rrfK: null }).rrfK).toBe(60)
    expect(raw({ embedBatchSize: 'abc' }).embedBatchSize).toBe(64)
  })

  it('合法值原样通过;边界值接受', () => {
    const v = TunableSchema({ chunkTarget: 800, chunkMax: 900, chunkOverlap: 100, topK: 3, rrfK: 60, embedBatchSize: 32 })
    expect(v).toMatchObject({ chunkTarget: 800, chunkMax: 900, chunkOverlap: 100, topK: 3, rrfK: 60, embedBatchSize: 32 })
    expect(TunableSchema({ chunkTarget: LIMITS.chunkTarget[0] }).chunkTarget).toBe(LIMITS.chunkTarget[0])
    expect(TunableSchema({ embedBatchSize: LIMITS.embedBatchSize[1] }).embedBatchSize).toBe(LIMITS.embedBatchSize[1])
  })

  it('LIMITS 覆盖全部数值参数且下限 ≥ 1(overlap 例外:允许 0)', () => {
    for (const key of ['chunkTarget', 'chunkMax', 'topK', 'rrfK', 'embedBatchSize'] as const) {
      expect(LIMITS[key][0]).toBeGreaterThanOrEqual(1)
      expect(LIMITS[key][1]).toBeGreaterThan(LIMITS[key][0])
    }
    expect(LIMITS.chunkOverlap[0]).toBe(0)
  })
})
