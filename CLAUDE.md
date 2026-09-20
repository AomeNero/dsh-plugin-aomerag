# CLAUDE.md

dsh-aomerag(包名 `dsh-plugin-aomerag`):deepseek-harness 知识库插件,AomeRAG 检索管线(切片 → 向量化 → 混合检索)的纯 TypeScript 移植,不依赖 AomeRAG 进程在线。

## 关键文档(动手前先读)

- `docs/spec.md` — 需求与已确认决策(能力范围、测试缝、Out of Scope)
- `docs/spike.md` — 技术定案与 sqlite-vec 两坑的绕过模式
- `docs/plan.md` — 模块划分、接口契约(§2 已冻结)、P0–P7 阶段与各自 DoD

## 环境事实

- dsh 依赖:自 0.1.6-alpha.2 起全部走官方 npm(`.npmrc` 强制 @deepseek-ai 官方源),**必须 exact pin**(latest dist-tag 停滞在 rc.x);`link:` 已退役;checkout `D:\GitHub\deepseek-harness` 仅作源码参考与 `vendor/cordis/bin.js` 加载器
- 加载链:项目 devDeps 需 `@deepseek-ai/cordis-plugin-include`(bin.js 从项目根=ctx.baseUrl 解析裸包名);**cordis 4 默认 logger 对 console 静默**(日志只进内存 buffer),loader 层报错看不见,排查靠插件自身 console 输出或 dump `ctx.logger.buffer`
- 蓝本项目与验收语料:`D:\Code\AomeCode`(其 `raw/md-data`)
- 本机 Ollama:`bge-m3` 1024 维(选型定案),备选 `qwen3-embedding:4b`
- 原生模块构建审批在 `pnpm-workspace.yaml`(onlyBuiltDependencies/allowBuilds)

## 命令

- `pnpm test` — unit + integration;`pnpm test:live` — 真 Ollama 档;`pnpm typecheck` — tsc --noEmit
- 加载插件:`cd` 到含 cordis.yml 的目录 → `node D:\GitHub\deepseek-harness\vendor\cordis\bin.js`;插件行路径必须写 `file:///D:/...` URL
- spike 复现:`node spike/spike-{a,b,c,d}-*.ts`(Node 24 原生 TS,无 tsx)

## 硬约束

- **Node 24 原生 type stripping 直跑 `.ts`**:相对导入必须带 `.ts` 扩展;tsconfig 已开 `erasableSyntaxOnly`(禁 enum/namespace/参数属性)与 `verbatimModuleSyntax`(类型导入用 `import type`)
- **sqlite-vec 两坑**(见 docs/spike.md Spike A):vec0 不绑定显式 rowid(自动分配 + `last_insert_rowid()` 回填);KNN 用子查询 LIMIT 模式
- **唯一测试缝 = `ctx.tools.execute` 工具管线**;纯函数(tokenize/chunker/rrf)允许细粒度单测;断言只看外部行为,不断言内部调用序列
- **TDD**:每阶段先写测试看着失败 → 最小实现看着通过 → 重构;Ollama 在 HTTP 边界 mock(undici MockAgent)
- **依赖单向无环**:`tools/index → sync/retriever → store/embedder → chunker/tokenize/rrf`
- 接口契约(docs/plan.md §2)已冻结,改动需先更新计划文档
- 中文全文检索:Intl.Segmenter 预分词 + FTS5 unicode61,入库与查询共用同一 `tokenize()`
