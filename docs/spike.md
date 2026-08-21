# Spike 技术选型结论

> 日期：2026-08-19 · 环境：Windows 10 · Node v24.16.0 · pnpm 11.12.0 · 本地 dsh checkout（`D:\GitHub\deepseek-harness`）
>
> 复现脚本：`spike/spike-{a,b,c,d}-*.ts`（一次性验证代码，实现期不进 src/）

## Spike A：better-sqlite3 + sqlite-vec —— ✅ 可行（两个坑已绕过）

**结论**：better-sqlite3 13.0.3（SQLite 3.53.4）+ sqlite-vec 0.1.9 在 Windows/pnpm 下加载、KNN、持久化全部可用。

| 验证点 | 结果 |
|---|---|
| 原生绑定加载（需 `pnpm-workspace.yaml` onlyBuiltDependencies + rebuild） | ✅ |
| vec0 虚拟表 + Float32Array→Buffer 绑定 | ✅ |
| KNN MATCH + 子查询 join 元数据 | ✅ |
| 文件库持久化 + 重开重载扩展 | ✅ |

**坑 1（必须绕过）**：显式 `rowid` 绑定插入 vec0 报 `Only integers are allowed`（better-sqlite3 13.x 绑定层与 sqlite-vec 0.1.9 交互 bug；硬编码 SQL 正常，纯绑定参数必炸）。
→ **数据模型改为**：先插 vec0（自动分配 rowid）→ `last_insert_rowid()` → 事务内用该 rowid 插入元数据表。删除走反向（先查 rowid 集合，事务内删两表）。

**坑 2（必须绕过）**：vec0 KNN 查询必须让 LIMIT 直接约束 vec0 扫描，`JOIN ... LIMIT` 报 `A LIMIT or 'k = ?' constraint is required`。
→ **查询模式**：`FROM (SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT ?) t JOIN chunks c ON c.rowid = t.rowid`。

npm 上 sqlite-vec 最新稳定即 0.1.9（0.1.10 仅 alpha），无可升级修复。

## Spike B：FTS5 中文检索 —— ✅ 定案 Segmenter 预分词

**结论**：采用 **方案 2：`Intl.Segmenter('zh-CN')` 预分词（空格 join）+ FTS5 unicode61**，入库与查询走同一 `tokenize()` 函数。

| 方案 | 4 条中文查询命中 | 2 字词（"电源"） | 依赖 | 索引体积 |
|---|---|---|---|---|
| unicode61 直存（对照） | 0/4 | — | — | — |
| trigram tokenizer | 4/4 | ❌ 不能（≥3 字符硬伤） | 零 | 大（3-gram 膨胀） |
| **Segmenter + unicode61** | **4/4** | **✅ 能** | **零（Node 内建）** | 小（词级） |

性能：1 万次短文本分词 ≈ 100ms，可忽略。分词层独立成单一函数，将来可无痛换分词器。

## Spike C：Ollama bge-m3 embedding —— ✅ 全部通过

**结论**：采用**新 API `POST /api/embed`**（`{model, input: string[]}` → `{embeddings: number[][]}`），批量一次往返。

| 验证点 | 结果 |
|---|---|
| bge-m3 在线，维度 **1024** | ✅（旧 `/api/embeddings` 单条接口亦可用，不采用） |
| 批量接口：20 条短文本 | ✅ 599ms（≈33 条/秒，万级 chunk 全量灌库约 5 分钟，可接受） |
| 中文语义质量 | ✅ 电源(中)↔power(英)=0.742 ＞ 电源(中)↔Recipe(中)=0.380 |
| 错误格式 | ✅ HTTP 404 + `{"error": "model ... not found"}` JSON（客户端按 `error` 字段报错即可） |

**embedder 客户端契约要点**：批量端点 `/api/embed`；失败按 HTTP 状态 + `error` 字段抛响亮错误；维度从首条响应校验（与配置 `EMBED_DIM` 不符时启动即报）。
备选模型：本机另有 `qwen3-embedding:4b`，配置项留 `model` 字段即可切换，无需代码改动。

## Spike D：dsh 插件加载链路 —— ✅ 全链路通过

**结论**：独立目录插件可被 dsh 加载并完整工作。**开发工作流定案**：

1. **依赖解析**：npm 上 `@deepseek-ai/dsh-tools` 依赖 `dsh-type-meta` 未发布（rc 包发布不完整），**npm 路线不可用**。改用 **`pnpm link:` 指向本地 dsh 仓库包目录**（symlink 穿透解析，包自身依赖落到 dsh workspace 的 node_modules）：

   ```sh
   pnpm add link:D:/GitHub/deepseek-harness/vendor/cordis \
            link:D:/GitHub/deepseek-harness/vendor/include \
            link:D:/GitHub/deepseek-harness/vendor/loader \
            link:D:/GitHub/deepseek-harness/vendor/schemastery \
            link:D:/GitHub/deepseek-harness/packages/core/tools \
            link:D:/GitHub/deepseek-harness/packages/core/system-prompt \
            link:D:/GitHub/deepseek-harness/packages/llm/llm
   ```

   （本地包版本 0.1.0-rc.7 与 npm 0.0.1-rc.1 不同步——以本地 checkout 为准）

2. **插件路径**：cordis loader 从 **cwd**（baseUrl）解析包名和插件 import；Windows 绝对路径插件行必须写 **`file:///D:/...` URL**（裸 `D:/...` 报 protocol 错）。
3. **运行方式**（无 UI 快速验证）：`cd <含 cordis.yml 的目录> && node D:\GitHub\deepseek-harness\vendor\cordis\bin.js`（读 cwd 的 `cordis.yml`；Web UI 场景用 `pnpm dsh web --patch`）。
4. **TypeScript 运行**：Node 24 原生 type stripping 直跑 `.ts`，**无需 tsx/esbuild**（tsx 已从依赖移除）。
5. 组合最小集：`@deepseek-ai/dsh-system-prompt`（systemPrompt 服务提供方）+ `@deepseek-ai/dsh-tools`（tools 服务）+ 插件行。

**双实例 cordis 风险已消除**：link: 模式下插件 import 的 `@deepseek-ai/cordis` 与 loader 侧是同一份（symlink 指向同一物理包），无 dual-package 问题。

## 对 spec 的回写

- Implementation Decisions 中「中文 FTS：trigram 或预分词二选一」→ **定为 Intl.Segmenter 预分词**。
- Embedding 客户端 → **定案 `/api/embed` 批量端点**，维度 1024 校验、错误按 `error` 字段响亮抛出。
- 新增实现约束：vec0 的 rowid 模式与 KNN 子查询模式（见 Spike A 两坑）。
- 开发工作流（link: 本地包 + file:/// 路径）写入项目 README/CLAUDE.md（实现期做）。

## 遗留风险（实现期处理）

- UI 设置卡片的 client bundle 产物格式（官方 tsdown preset 未发布）——spec 已有降级路径（kb_status 工具），实现到 UI 阶段再 spike。
- dsh 本地 checkout 更新（git pull）后，link: 的包若发生 breaking change 需同步适配——锁 dsh checkout 版本可缓解。
