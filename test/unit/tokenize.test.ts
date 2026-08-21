import { describe, expect, it } from 'vitest'
import { tokenize } from '../../src/tokenize.ts'

// 行为定义(spike B 定案):Intl.Segmenter('zh-CN', word) 分词,过滤纯空白 segment,空格 join。
// 入库与查询共用同一函数 —— 只测外部行为,不断言 ICU 具体切词点。

describe('tokenize: 中文', () => {
  it('多词中文句会被切分为多个词(空格分隔)', () => {
    const out = tokenize('电源模块设计说明')
    // spike B 实测:该句切出多个词;若整串一个词说明分词失效
    expect(out.trim().split(' ').length).toBeGreaterThanOrEqual(2)
  })

  it('分词不丢字符:去空格后还原原文', () => {
    const text = '输入电压范围 3.3V 至 5V,支持过流保护与软启动。'
    expect(tokenize(text).split(/\s+/).join('')).toBe(text.split(/\s+/).join(''))
  })

  it('词间以单空格分隔,无连续空格与首尾空格', () => {
    const out = tokenize('电测产品履历查询流程')
    expect(out).toBe(out.trim())
    expect(out).not.toMatch(/\s{2,}/)
  })
})

describe('tokenize: 英文与混合', () => {
  it('纯英文单词原样保留', () => {
    expect(tokenize('hello world')).toBe('hello world')
  })

  it('英文单词作为整体 token 出现在混合文本中', () => {
    const out = tokenize('Recipe 由多个时序段组成').split(' ')
    expect(out).toContain('Recipe')
  })

  it('空白序列坍缩为单空格(换行/制表符过滤)', () => {
    expect(tokenize('a\n\t b')).toBe('a b')
  })
})

describe('tokenize: 边界', () => {
  it('空字符串返回空字符串', () => {
    expect(tokenize('')).toBe('')
  })

  it('纯空白输入返回空字符串', () => {
    expect(tokenize('  \n\t ')).toBe('')
  })
})
