import { defineConfig } from 'vitest/config'

// 三档测试(对齐 docs/plan.md §4):
//   unit         纯逻辑(tokenize/chunker/rrf 等),默认跑
//   integration  工具缝(ctx.tools.execute 驱动插件),默认跑
//   live         真 Ollama,仅 `pnpm test:live` 单独跑(对应 AomeRAG 的 -m live 惯例)
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'live',
          include: ['test/live/**/*.test.ts'],
        },
      },
    ],
  },
})
