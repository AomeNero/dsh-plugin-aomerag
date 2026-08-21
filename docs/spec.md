# 需求文档（Spec）：dsh-aomerag —— deepseek-harness 知识库插件

> 状态：ready-for-agent · 蓝本：AomeRAG（Python Agentic RAG 系统） · 目标框架：DeepSeek Harness（dsh，developer preview）
>
> 本文档由 2026-08-19 的需求澄清会话综合而成，所有「Implementation Decisions」均已经用户逐项确认。

---

## Problem Statement（问题陈述）

公司的私域知识（硬件规格、API 文档、故障案例等）目前沉淀在 AomeRAG 系统里：它是一个独立的 Python 服务，用户要检索知识必须单独启动它、打开它的网页提问。

而用户的日常工作流正在迁移到 DeepSeek Harness（dsh）——在 dsh 里与 agent 对话、写代码、执行任务。此时出现断层：

- dsh 的 agent **检索不到**公司私域知识，回答只能靠模型自身，无出处、易瞎编；
- 用户要在 AomeRAG 网页和 dsh 之间**来回切换**，两套问答入口割裂；
- 若想让 dsh 复用 AomeRAG，唯一办法是让 AomeRAG 服务**常驻在线**做桥接——部署负担重，且 AomeRAG 与 dsh 的模型/循环能力大量重叠，维持两套 agent 得不偿失。

用户需要的是：**在 dsh 内部直接拥有 AomeRAG 的知识检索能力，且不依赖 AomeRAG 进程在线。**

## Solution（解决方案）

开发一个**独立、自包含的 dsh 插件** `dsh-aomerag`（包名 `dsh-plugin-aomerag`），以 AomeRAG 的检索管线为蓝本，用 TypeScript 重写其「切片 → 向量化 → 混合检索」核心，跳过其清洗管线（只吃 `.md` 文件）：

- **零命令入库**：把 `.md` 文件放进配置的知识目录，插件启动时自动增量同步（内容哈希对比，只处理变更文件）；
- **agent 可检索**：向 dsh 工具注册表注册 `kb_search` 工具，agent 提问时自主调用，返回带来源（文档、标题路径、分数）的命中片段；
- **agent 可重灌**：`kb_ingest` 工具让 agent（或用户通过对话）触发重新导入，文件更新无需重启；
- **状态可见**：Web 设置卡片展示索引状态（文档数/chunk 数/最后同步时间）并提供手动同步按钮；
- **单文件存储**：向量与全文索引落在单个 SQLite 数据库文件中，备份即拷贝。

运行时仅有的外部依赖：**Ollama**（提供 bge-m3 embedding，HTTP 调用，与 AomeRAG 同款）。

## User Stories（用户故事）

**检索问答（核心价值）**

1. 作为 dsh 用户，我想让 agent 能检索公司私域知识库，这样我在 dsh 里提问就能得到有出处的回答，不用切换到 AomeRAG 网页。
2. 作为 dsh 用户，我想让每条命中都携带来源信息（源文档、标题路径、得分），这样我可以核实回答的依据。
3. 作为 dsh 用户，我想让中文提问能命中中文文档（混合检索的全文通道对中文有效），这样知识库主体是中文时检索不失效。
4. 作为 dsh 用户，我想混合检索同时利用语义相似与关键词命中（RRF 融合），这样无论措辞改写还是精确型号名都能查到。
5. 作为 dsh 用户，我想命中数量（top_k）可配置，这样我能按任务在召回广度与上下文占用之间权衡。

**agent 工具契约**

6. 作为 agent，我想 `kb_search` 的参数 schema 清晰（必填 query、可选 top_k），这样我第一次就能正确调用。
7. 作为 agent，我想检索 0 命中时收到明确的结果状态而非报错，这样我能告知用户知识库缺失，而不是编造答案。
8. 作为 agent，我想 `kb_ingest` 返回处理摘要（新增/更新/跳过/失败各多少文件），这样我能向用户如实报告导入结果。
9. 作为 agent，我想在用户说"我更新了文档，重新导一下"时能自主调用 `kb_ingest`，这样不需要用户知道任何命令。
10. 作为 agent，我想 Ollama 不可用时工具返回清晰的错误消息，这样我能把故障转述给用户而不是无限重试。
11. 作为 agent，我想工具执行支持中断信号（signal），这样用户取消时同步/检索能及时停止。

**自动同步与数据管理**

12. 作为 dsh 用户，我想把 `.md` 文件放进知识目录后、插件启动时自动增量入库，这样我不需要执行任何手动步骤。
13. 作为 dsh 用户，我想未变更的文件（内容哈希一致）在同步时被跳过，这样重灌既快又省 embedding 调用。
14. 作为 dsh 用户，我想变更文件的旧切片被先删后插（幂等），这样重灌后不留重复或残留内容。
15. 作为 dsh 用户，我想知识目录里已删除的文件在下次同步后从索引中消失，这样索引不积累脏数据。
16. 作为 dsh 用户，我想同步过程中仍能检索已入库的部分（状态标记"同步中"），这样大库首次灌库时不至于完全不可用。
17. 作为 dsh 用户，我想向量库是单个 SQLite 文件，这样备份、迁移、清空都是简单操作。

**配置与可观测性**

18. 作为 dsh 用户，我想在 Web 设置页看到索引状态卡片（文档数、chunk 数、向量维度、最后同步时间、进行中状态），这样我知道知识库是否就绪。
19. 作为 dsh 用户，我想在设置卡片上点"立即同步"按钮，这样文件变更后无需重启立即生效。
20. 作为插件部署者，我想所有可调参数（知识目录、数据库路径、Ollama 地址与模型、chunk 尺寸、top_k 等）都通过 cordis.yml 的 config 传入并带默认值，这样换部署不改代码。
21. 作为插件部署者，我想非法配置（如知识目录不存在、维度与模型不符）在插件加载时响亮失败并说明原因，这样错误在启动时暴露而不是运行时静默。

**工程质量（开发者）**

22. 作为插件开发者，我想测试从 dsh 工具执行管线这一条缝驱动全部外部行为，这样测试稳定贴近真实调用路径且缝唯一。
23. 作为插件开发者，我想 Ollama 调用在测试中被 mock 在 HTTP 边界、另有 live 标记的真 Ollama 集成测试，这样 CI 快速且真实环境也可验证。
24. 作为插件开发者，我想切片器与 RRF 融合这类纯逻辑有细粒度单测（中文标题、短文档、超长文档等边界），这样核心算法回归可精确定位。
25. 作为插件开发者，我想插件加载/卸载干净（Cordis effect 自动清理、后台任务可中止），这样支持 dsh 的热重载与 HMR。
26. 作为插件开发者，我想 embedding 批量调用有并发上限，这样大库灌入时不压垮本地 Ollama。

## Implementation Decisions（实现决策）

以下决策均已在需求澄清中由用户逐项确认：

### 总体

- **形态**：dsh 插件（TypeScript/Cordis），导出 `apply(ctx, config)`；不是 Claude Code 插件、不是 AomeRAG 内部模块。
- **架构路线**：纯 TS 独立插件（自包含能力），运行时不依赖 AomeRAG 服务；AomeRAG 仅作为算法蓝本与（可选的）md 数据源。
- **包结构**：独立 pnpm TypeScript 包，落在新项目目录；Host 半（服务/工具/存储/同步）+ 浏览器半（设置卡片）双入口，浏览器半按 dsh 约定经 `dsh.client` 声明导出。v1 以 cordis.yml patch 指向本地源码加载，不发布 npm。
- **命名**：插件 `dsh-aomerag`，包 `dsh-plugin-aomerag`。

### 能力范围（MVP）

- 管线覆盖 **chunk → index → search**；**不做 clean**（PDF/docx→md 转换不实现，输入只认 `.md`）。
- 对外能力面：`kb_search` 工具 + `kb_ingest` 工具 + 启动自动增量同步 + Web 设置卡片（状态 + 手动同步）。

### 存储与检索（移植自 AomeRAG）

- 存储：**better-sqlite3 + sqlite-vec**（dense KNN）+ **FTS5**（关键词通道），单库单文件；chunk 元数据（源文档、标题路径、内容哈希）与向量同库。
- 检索：dense 与 FTS 双通道并行查询 → **RRF 融合**排序 → top_k 命中（携带 source_doc/heading_path/score），参数默认值对齐 AomeRAG（top_k=6）。
- 切片：Markdown 标题层级结构化切分 + 定长兜底，参数默认对齐 AomeRAG（target=1200 / max=1600 / overlap=200，短文档整篇一块）。
- 幂等：文件级内容哈希（sha）；变更文件先删旧 chunk 再插入；目录中已消失的文件在同步时清理其索引数据。
- 中文全文检索：FTS5 默认 tokenizer 对中文无效，采用「trigram 或入库预分词」之一，在实现阶段以 spike 定案并记录于项目 ADR（验收以中文查询命中为标准，不锁定具体 tokenizer）。

### Embedding

- 引擎：**Ollama HTTP API**（bge-m3，1024 维），与 AomeRAG 完全一致，用户机器已具备；不使用 DeepSeek API（无 embedding 端点）。
- 批量调用带并发上限（默认值可配）；失败响亮报错、不静默吞。

### 同步模型

- 启动时后台增量同步（apply 内触发，不阻塞插件就绪）；同步期间 `kb_search` 可查已入库部分，状态接口报告"同步中"。
- 同步全程可通过 effect 清理（插件卸载/HMR 时中止后台任务）。

### 配置

- 遵循 dsh 约定：**凡可调参数一律走 Schemastery Config schema**（cordis.yml 传值、带默认值、加载期校验）。至少覆盖：知识目录、数据库路径、Ollama base URL 与模型、embedding 维度、chunk 三参数、top_k、RRF 常数、同步并发上限。

### UI 卡片与降级

- 设置卡片按 dsh settings 机制实现（Host 半注册 namespace + 浏览器半注册卡片）。
- **已知风险**：dsh 官方 client bundle 构建预设未对外发布，独立包需自行复现产物格式且受 bundle-purity 约束。**兜底决策**：若 v1 无法产出合规卡片，UI 能力降级为 `kb_status` 工具（返回状态与统计），卡片延后到 v2；此降级不改变其余范围。

## Testing Decisions（测试决策）

- **测试缝：全项目唯一架构缝 = dsh 工具执行管线**（`ctx.tools.execute` 驱动 `kb_search` / `kb_ingest`，及降级时的 `kb_status`）。所有外部行为断言都从这条缝进入；启动自动同步在测试 harness 中加载插件后经状态断言。
- **好测试的定义**：只断言外部可观察行为（工具返回结构与内容、库状态变化、错误消息），不断言内部函数调用序列或私有状态。
- **粒度补充**：chunker 与 RRF 融合是纯函数，允许直接细粒度单测（中文/短文/超长文/标题嵌套边界）；这是测试粒度选择，不构成新架构缝。
- **Ollama 边界**：单测/集测在 HTTP 边界 mock（返回固定 1024 维向量）；真 Ollama 集成测试以 live 标记隔离，按需运行（沿用 AomeRAG 的 `-m live` 惯例）。
- **文件系统 fixture**：临时目录 + 样例 `.md`（含中文、标题层级、超长段落、重复内容文件），覆盖增量/幂等/删除清理路径。
- **测试框架**：vitest（dsh 仓库同款）；可用 dsh 的 test-support 设施构造最小 Cordis 应用加载插件。
- **先例**：AomeRAG 的 tests 目录（unit + integration + live 分层，151 用例）为本插件的测试组织蓝本；dsh 各包的 vitest 体系为框架侧先例。

## Out of Scope（明确不做）

- **clean 管线**：PDF/docx/xlsx → md 的清洗转换（继续由 AomeRAG 或人工承担，产出 `.md` 后喂给本插件）。
- **发布 npm**：v1 仅本地 cordis.yml patch 加载；发布流程留待 v2。
- **AomeRAG 桥接**：不做 HTTP 调用 AomeRAG 服务的任何模式。
- **rerank / 查询改写 / 检索参数学习**：重排延后（与 AomeRAG 的设计决策一致）。
- **文件 watcher 实时监听**：v1 同步触发点仅三个——启动、`kb_ingest` 工具、设置卡片按钮。
- **多知识库/多租户/权限**：单库单目录。
- **会话管理、反馈系统、管理后台页面**：这些是 AomeRAG 作为完整产品的职责；dsh 自带会话与设置基础设施。
- **非 `.md` 格式输入**（含 `.txt`）：v1 不做。

## Further Notes（补充说明）

- **框架风险**：dsh 处于 developer preview，插件 API 会有破坏性变更。对策：插件内部薄封装 dsh 依赖面（工具注册、config、settings 三处），其余逻辑自包含，降低迁移成本。
- **原生模块风险**：better-sqlite3 与 sqlite-vec 含原生绑定，Windows + pnpm 环境需验证 prebuilt 二进制可用；若 sqlite-vec 加载失败，降级评估 FTS-only 模式（功能损失 dense 通道）——此为实现期风险项，不改变需求。
- **数据来源建议**：可直接将 AomeRAG 清洗产物目录（md-data）配置为本插件的知识目录做验收语料。
- **术语**：本文档中「知识目录」指存放 `.md` 源文件的配置目录；「库文件」指 SQLite 存储；「同步」指 增量扫描→切片→向量化→入库 的完整动作。
