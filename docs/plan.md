# 实施计划：dsh-aomerag

> 依据：`docs/spec.md`（需求）+ `docs/spike.md`（技术定案） · 2026-08-19
>
> 原则：TDD（先测后码）、单一测试缝（`ctx.tools.execute`）、每阶段有可验证的完成标准。

## 1. 模块划分与依赖方向

```
src/
├─ index.ts        # 插件入口: name/inject/Config/apply —— 装配一切, 注册工具, 触发启动同步
├─ config.ts       # Schemastery Config schema (cordis.yml 传参, 全参数可配)
├─ tokenize.ts     # Intl.Segmenter 中文分词 (纯函数, 入库/查询共用)
├─ chunker.ts      # Markdown 标题层级切片 + 定长兜底 (纯函数)
├─ rrf.ts          # RRF 融合排序 (纯函数)
├─ embedder.ts     # Ollama /api/embed 批量客户端 (维度校验, 响亮错误)
├─ store.ts        # SQLite 存储层: sqlite-vec KNN + FTS5 + 元数据表 + 文件登记表
├─ retriever.ts    # 混合检索编排: dense + FTS → RRF → top_k
├─ sync.ts         # 增量同步引擎: 扫描 → sha 对比 → 先删后插 → 清理已删文件
├─ tools.ts        # kb_search / kb_ingest / kb_status 的 defineTool 定义
└─ client/         # UI 设置卡片 (浏览器半; 风险项, 失败则降级仅 Host 半)
```

依赖方向（单向，无环）：`tools/index → sync/retriever → store/embedder → chunker/tokenize/rrf`。
纯函数层（tokenize/chunker/rrf）不依赖任何 IO，测试最密集。

## 2. 关键接口契约

```ts
// tokenize.ts
export function tokenize(text: string): string   // 分词后空格 join

// chunker.ts
export interface Chunk { content: string; headingPath: string; index: number }
export function chunkMarkdown(md: string, opts: { target: number; max: number; overlap: number }): Chunk[]

// rrf.ts
export interface Scored { id: number; score: number }
export function rrfFuse(dense: Scored[], fts: Scored[], k?: number): Scored[]  // k 默认 60 (对齐 AomeRAG)

// embedder.ts
export class Embedder {
  constructor(opts: { baseUrl: string; model: string; dim: number })
  embed(texts: string[]): Promise<Float32Array[]>   // 批量单请求; 维度不符抛错
  ping(): Promise<boolean>                           // 启动健康检查
}

// store.ts  (固化 spike A 两个绕过模式)
export class KbStore {
  static open(path: string, opts: { dim: number }): KbStore          // :memory: 可用于测试
  upsertDoc(docId: string, chunks: Chunk[], vectors: Float32Array[]): void  // 事务: 删旧+插 vec0 自动 rowid+回填元数据
  deleteDoc(docId: string): void
  knn(vec: Float32Array, k: number): Array<{ rowid: number; distance: number }>   // 子查询 LIMIT 模式
  fts(tokenizedQuery: string, k: number): Array<{ rowid: number; rank: number }>
  chunkMeta(rowids: number[]): Array<{ sourceDoc: string; headingPath: string; content: string }>
  docCount(): { docs: number; chunks: number }
  fileRegistry: { get(docId): { sha: string } | undefined; set(docId, sha): void; prune(validIds): void }
}

// retriever.ts
export interface Hit { sourceDoc: string; headingPath: string; content: string; score: number }
export function hybridSearch(deps: { store: KbStore; embedder: Embedder }, query: string, topK: number): Promise<Hit[]>

// sync.ts
export interface SyncReport { added: number; updated: number; skipped: number; removed: number; failed: number; errors: string[] }
export async function syncDir(deps: { store: KbStore; embedder: Embedder }, dir: string, opts: ChunkOptions): Promise<SyncReport>
```

**Config 字段**（默认值对齐 AomeRAG）：`mdDir=./data/md`、`dbPath=./data/aomerag.sqlite`、`ollamaBaseUrl=http://127.0.0.1:11434`、`embedModel=bge-m3`、`embedDim=1024`、`chunkTarget=1200`、`chunkMax=1600`、`chunkOverlap=200`、`topK=6`、`rrfK=60`、`embedBatchSize=64`、`syncOnStart=true`。

**工具契约**：
- `kb_search(query: string, top_k?: number) → { hits: Hit[]; status: 'ok' | 'syncing' | 'empty' }`
- `kb_ingest(dir?: string) → SyncReport`（缺省用配置目录）
- `kb_status() → { docs; chunks; lastSyncAt; syncing; dbPath; model }`（UI 卡片降级时它是唯一状态面）

## 3. 分阶段实施（TDD）

| 阶段 | 内容 | 验证标准（DoD） |
|---|---|---|
| **P0 基建** | tsconfig、vitest 配置（unit/integration/live 三档）、npm scripts、README + CLAUDE.md（工作流命令固化）、`data/` gitignore 化、git init | `pnpm test` 空跑通过；`tsc --noEmit` 通过 |
| **P1 纯逻辑** | tokenize → chunker → rrf，测试先行 | 单测覆盖：中文/英文/混合分词；标题嵌套/短文整篇/超长定长/overlap 边界；RRF 排序正确性 |
| **P2 存储层** | KbStore（spike A 模式直接落地） | 临时目录数据库测试：建表/插入/KNN 距离序/FTS 中文命中/按文档删除/文件登记 prune/持久化重开 |
| **P3 embedder** | Ollama 客户端 + undici MockAgent mock | mock 测试：批量/维度校验/404 错误格式；`-m live` 真 Ollama 测试 |
| **P4 同步引擎** | syncDir（fixture 临时目录 + mock embedder） | 测试：首灌/未变跳过/变更更新/删除清理/坏文件容错（failed 计数不中断）|
| **P5 工具层 + 入口** | tools.ts + index.ts（apply 装配） | **主缝集成测试**：测试 harness 加载插件 → `ctx.tools.execute` 驱动三工具全契约；启动同步后 kb_status 断言；HMR 卸载清理无泄漏 |
| **P6 UI 卡片** | 先 spike client bundle 格式；成功→Host 半 settings namespace + 卡片；失败→v1 只留 kb_status | 成功：dsh web 设置页出现卡片可点同步；失败：降级记录进 spike.md，kb_status 已可用 |
| **P7 端到端验收** | spec DoD 全项 | 真 Ollama + dsh web：AomeRAG md-data 样例入库 → 聊天提问 → 模型调 kb_search 命中带出处；kb_ingest 对话触发重灌；覆盖率 ≥80% |

每阶段遵循：**先写测试（看着失败）→ 最小实现（看着通过）→ 重构**。

## 4. 测试策略

- **框架**：vitest；project 分档：`unit`（默认）、`integration`（工具缝）、`live`（真 Ollama，`-m live` 单独跑）
- **mock 策略**：Ollama 在 HTTP 边界 mock（undici `MockAgent`，Node 内置无新依赖）；文件系统用 `os.tmpdir` fixture；工具缝用最小 Cordis app 加载插件（对齐 spike D 的 cordis.yml 模式）
- **断言原则**：只测外部行为（工具返回结构、库状态、错误消息），不断言内部调用序列
- **覆盖率**：≥80%（vitest coverage, 全局规则）

## 5. 风险与应对

| 风险 | 应对 |
|---|---|
| P6 client bundle 格式复现失败（官方 preset 未发布） | 已定降级：v1 仅 kb_status；spec 已背书 |
| dsh checkout 升级后 link: 包 breaking | 项目期锁定 dsh checkout；改动前重跑 P5 集成测试 |
| 大库同步阻塞启动 | 同步后台跑（不阻塞 apply 返回），kb_search 期间可用（status: 'syncing'）|
| embedBatchSize 压垮 Ollama | 默认 64，批量内串行分批，失败重试一次后计入 SyncReport.failed |

## 6. 明确不做（引用 spec Out of Scope）

clean 管线 / npm 发布 / AomeRAG 桥接 / rerank / 文件 watcher / 多库 / 非 md 输入。
