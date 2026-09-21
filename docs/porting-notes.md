# 移植差异与关键点记录(AomeRAG Python → dsh-aomerag TS)

> 伴随实现持续追加。每条差异记录:内容、原因(蓝本语义 vs 本插件环境)、影响面。
> 目标:任何后来者(含 agent)不读蓝本源码也能理解本插件每个"不寻常"的写法。

## P1 纯逻辑层(tokenize / chunker / rrf)

### 1. 字符计数按 code point,而非 JS `.length`

- **蓝本**:Python `len()` 是 Unicode 码点数。
- **本插件**:JS `.length` 是 UTF-16 code unit 数;emoji/扩展汉字(代理对)占 2。
- **影响**:若按 `.length` 切,硬切窗口可能切在代理对中间产生乱码;窗口尺寸判定也与蓝本语义漂移。
- **做法**:chunker 内所有长度判定与切片统一用 `[...str]`(code point 数组)——窗口累积、overlap 尾接、硬切步长全部如此。有测试锁定(emoji 硬切完整)。

### 2. 分行必须吃 CRLF

- **蓝本**:`str.splitlines()` 天然处理 `\r\n`。
- **本插件**:JS `split('\n')` 会在行尾残留 `\r`,Windows 语料(CRLF)下标题正则失配、正文混入 `\r`。
- **做法**:`markdown.split(/\r?\n/)`。段落切分 `/\n\s*\n/` 中 `\r` 属 `\s`,天然兼容。

### 3. RRF 无蓝本实现可抄,按标准公式移植

- **蓝本**:zvec 库内置 `RrfReRanker()`(k 默认 60),Python 侧无 RRF 代码。
- **做法**:标准公式 `score(d) = Σ 1/(k + rank)`,rank 从 1 起按通道输入序;原始分数不参与融合。
- **自行决定的语义**:同分时按稳定次序(dense 通道项在前)——蓝本未定义 tie 行为,JS `Array.sort` 稳定序保证确定性。

### 4. FTS 中文方案是本插件自定,蓝本走 zvec 内建 FTS

- **蓝本**:`zvec.Fts(query_string=原文)` 直存直查,中文处理由 zvec 内部负责。
- **本插件**:SQLite FTS5 unicode61 对中文直存失效(spike B 对照组 0/4 命中)→ 定案 `Intl.Segmenter('zh-CN', word)` 预分词空格 join,入库与查询共用同一 `tokenize()`。
- **影响**:`KbStore.upsertDoc` 入库时对 chunk 内容调用 `tokenize()` 写 FTS 表;`KbStore.fts()` 的入参约定为**已分词**查询串(调用方责任)。

### 5. Chunk 字段映射

蓝本 dict `{text, heading_path, chunk_index, source_doc, page}` → 本插件 `Chunk {content, headingPath, index}`(source_doc 移到 `upsertDoc(docId, ...)` 参数;page 是清洗管线产物,本插件不做 clean,无此字段)。

## P2 存储层(KbStore)

### 6. 三表同 rowid 对齐,替代蓝本的单库 zvec

- **蓝本**:zvec 单集合,向量与元数据同一 Doc 对象,无 FTS 表(zvec 内建 FTS)。
- **本插件**:`chunks`(元数据)+ `vec_chunks`(vec0 向量)+ `ft_chunks`(FTS5)三表,以 vec0 自动分配的 rowid 对齐。
- **插入模式**(坑1 绕过):插 vec0 → `last_insert_rowid()` → 事务内回填 chunks 与 ft_chunks(FTS 内容为 `tokenize(content)`)。三表插入/删除必须同事务。

### 7. deleteDoc 连带清登记,upsertDoc 不动登记

- **蓝本**:`delete_by_source` 只删向量集合;文件登记逻辑在 pipeline 层。
- **本插件**:`deleteDoc` = 三表 + `files` 登记一起清(语义:文档彻底移除);`upsertDoc` **不碰**登记表——sync 流程是"upsert 成功后才 `fileRegistry.set(sha)`",若 upsert 内部清登记会与该顺序打架。

### 8. docCount.docs 以 chunk 数据为准,不用登记表

`COUNT(DISTINCT source_doc) FROM chunks`。登记表反映同步进度,可能存在"已登记但 0 chunk"(空 md 文件)的状态,用它计数会虚高。kb_status 语义 = 库里实际有内容的文档数。

### 9. FTS5 rank 语义与 zvec score 相反

FTS5 `rank` 是 bm25,**越小越好**;zvec/向量 score 越大越好。通道内排序各自正确即可;RRF 融合只看通道内排名位置,不受影响。P5 retriever 实现时注意不要把 rank 当 score 用。

### 10. chunkMeta 宽容跳过不存在的 rowid

检索两步走(knn/fts → rrf → chunkMeta)期间,并发同步可能删掉部分 rowid;`chunkMeta` 跳过缺失项而非抛错,保证检索在同步期间可用(spec 用户故事 16)。

## P3 Embedder(Ollama 客户端)

### 11. 不兼容旧单条响应形状

- **蓝本**:`embeddings` 缺失时回退旧 `/api/embeddings` 单条形状(`data["embedding"]` 包一层列表)。
- **本插件**:只认 `/api/embed` 批量形状,形状不符响亮报错(spike C 定案——本机 Ollama 版本明确,兼容旧形状只会掩盖问题)。

### 12. 显式维度校验(蓝本没有)

- **蓝本**:向量维度完全信任上游,无校验。
- **本插件**:每条响应校验 `e.length === dim`,不符抛含期望/实得/模型名的错误——spec 用户故事 21「维度与模型不符在启动时响亮失败」的落点。live 档测试覆盖(故意配 dim=8 打 bge-m3)。

### 13. 错误消息自拼(HTTP 状态 + error 字段),并发限流移到 sync 层

- **蓝本**:httpx `raise_for_status()` 的默认错误文本;并发用注入的 `asyncio.Semaphore`。
- **本插件**:显式拼 `HTTP <status>: <error字段>` 响亮消息(spec 用户故事 10,Ollama 不可用时 agent 能转述故障);`embedBatchSize` 分批是 sync 层职责(P4),单请求内无并发概念,故 Embedder 无信号量。
- **已知取舍**:蓝本有 60s 超时,本插件暂无(spec 未要求;挂死请求会卡同步批次,P4 的 failed 容错可兜住后续文件,单批挂死仍会阻塞——若真实使用中出现再补)。

### 14. 测试基建:npm undici 必须与 Node 内置 undici 同大版本

`setGlobalDispatcher(mockAgent)` 能拦截全局 `fetch`,靠的是 npm undici 与 Node 内置 undici 共用同一个 `Symbol.for('undici.globalDispatcher.N')`。**npm undici@8 与 Node 24(内置 7.25)symbol 版本不匹配,mock 静默失效**——请求穿透到真 Ollama,测试"全绿"却是假的(本项目的失败模式恰好被维度断言抓住)。devDep 锁 `undici@7`(对齐 Node 24 内置);升级 Node 大版本时需同步核对。
副作用即防线:MockAgent 默认禁真实网络,未匹配请求会抛错,mock 失配不会静默通过——前提是断言够具体(本项目靠维度/状态码断言)。

## P4 同步引擎(syncDir)

### 15. 同步语义对齐蓝本 incremental_ingest

递归扫描 `.md`(小写后缀,大写 `.MD` 也收)、docId = posix 相对路径、sha = **sha1(原始字节)**、失败文件不登记(下次重试)、已删文件清数据+登记、`images/` 子树与 `~` 开头临时文件跳过(蓝本 md-data 目录约定,验收语料直接兼容)、扫描顺序字典序稳定(报告 errors 顺序确定)。

### 16. 报告字段细分 added/updated(蓝本只算 n_ingested)

蓝本不区分新增与变更;契约 SyncReport 细分 `added`/`updated`(判据:登记表有无该 docId),`skipped`/`removed`/`failed` 与蓝本 n_skipped/n_deleted 对应。这是 kb_ingest 工具向 agent 报告处理摘要的需要(spec 用户故事 8)。

### 17. embed 批次失败重试一次(蓝本无重试)

plan 风险表定案:分批串行(`batchSize` 默认 64,蓝本 embed_batch=16),批失败重试一次,仍失败抛响亮错误 → 该文件计入 `failed`,不中断其余文件。蓝本 embed 失败直接 failed,无重试。

### 18. 目录不存在:响亮抛错(蓝本静默空扫描)

蓝本 `if base.is_dir()` 否则静默跳过;本插件 `syncDir` 对不存在的目录直接 throw——spec 用户故事 21(非法配置加载时响亮失败)的同步入口版,kb_ingest 工具调用时 agent 能把错误转述给用户。

### 19. 状态存储从独立 StateStore 移入 SQLite files 表

蓝本增量状态走注入的 `ingest_state`(独立持久化);本插件就是 `KbStore.fileRegistry`(sha 登记表),库与状态单文件一致(备份即拷贝,spec 用户故事 17)。为此契约补了 `fileRegistry.keys()`(删除清理需枚举登记表)。

## P5 工具层 + 入口(retriever / config / tools / index)

### 20. ctx.effect 语义陷阱:函数体立即执行,返回值才是清理器

`ctx.effect(() => { store.close() })` 会在**注册时**立即关库(函数体即 effect 体),插件后续全部操作报 "The database connection is not open"。正确形态是 `ctx.effect(() => () => store.close())`(返回关库函数,卸载时执行)。集成测试第一轮全挂暴露。

### 21. undici MockAgent 的 reply 回调必须同步返回(P3 #14 续)

回调返回 Promise(如 async 函数或手动门闩)会让 mock 静默失效 → `fetch failed`。需要异步控制的场景改用 `.delay(ms)`(MockScope 方法,链在 `.reply()` 之后)。本项目的 syncing 状态测试用独立慢 origin(`:11435` + delay 400ms)实现,不影响其余测试速度。

### 22. dsh defineTool 的输出 schema 是严格契约

- object 节点必须显式 `additionalProperties: true/false`(省略直接抛 JsonSchemaError);我们全部用 `false`(输出结构固定,多余字段会在运行时被拒)。
- 可空字段无 `nullable` 语法,用 `oneOf: [{type:'string'},{type:'null'}]`(如 kb_status.lastSyncAt)。
- render(args, value) 产出的 ContentBlock 是**模型实际看到的**;结构化 value 是程序消费的。两边都有测试。

### 23. kNN 无距离阈值:empty 只代表空库(蓝本一致的设计)

dense 通道永远返回最近邻(不筛距离),RRF 融合后几乎总有 hits——`status: 'empty'` 仅在库空/未同步时出现。语义不相关的查询仍返回邻居,由模型侧自行判断低相关。有集成测试锁定此语义,防止将来误加阈值。

### 24. 集成测试 harness 形态与 Windows 句柄纪律

最小 app:`new Context()` + `ctx.plugin(SystemPrompt)` + `ctx.plugin(ToolRuntime)` + `ctx.plugin(aomerag, config)`;全部断言经 `ctx.tools.execute`(项目唯一架构缝)。Windows 下 afterEach 必须 `fiber.dispose()`(触发 `ctx.effect` 清理器关 SQLite),否则临时目录删除 EPERM(文件句柄未释放)。

### 25. chunkMeta 契约补 rowid:融合排序与元数据的可靠对齐

检索两步走(knn/fts → RRF → chunkMeta)存在并发同步删除窗口;chunkMeta 跳过缺失 rowid 时,纯顺序 zip 会把融合分错配到别的 chunk。返回结构补 `rowid` 字段,调用方按 id 对齐。

### 26. 冒烟定案:cords.yml + 真 loader + 真 Ollama 已通

`cordis.yml`(项目根,指向 spike/smoke.ts 自驱动插件)+ `node D:\GitHub\deepseek-harness\vendor\cordis\bin.js` 是全链路冒烟入口;bge-m3 首命中 score = 2/61(双通道均 rank1 的精确 RRF 值)验证了融合数学。

### 27. P6 UI 卡片 v1 降级(用户决策 2026-08-22)

机制侦查完毕(dsh.client 声明 + tsdown.client.ts 预设 + settings.plugins.tab slot + remote RPC,详见 spike.md P6 补充节),但实现全部落在 developer preview API 上且为项目最重增量。spec 预置的降级路径生效:状态可见性由 `kb_status` 承担、手动同步由 `kb_ingest` 对话触发承担,UI 卡片延后 v2。这不是失败,是计划内的风险分支(spec「UI 卡片与降级」节已背书)。

### 28. LanceDB 迁移(A 方案,2026-08-23,用户决策)

- **动机与时机**:用户在规模预期下选择现在迁移(经 grilling 确认:当前 9097 条 Lance 暴力扫描 16.7ms,与 sqlite-vec 31ms 同量级,性能收益待几十万条建 IVF-PQ 后兑现)。
- **双存储**:Lance 目录只存向量(id = chunks.rowid);元数据/FTS5/文件登记留 SQLite。接口语义不变,upsertDoc/deleteDoc/knn/close 因 Lance 异步 API 异步化(open 保持同步、内部惰性连接)。
- **退役**:vec0 两坑(#坑1 显式 rowid 绑定 / #坑2 KNN 子查询 LIMIT)随 vec0 虚拟表退役;rowid 分配回归 SQLite `AUTOINCREMENT`(永不复用,新旧 id 无重叠,Lance delete/add 顺序安全)。
- **新坑与绕过**:①SQLite 与 Lance 跨库无原子事务——顺序固定为"SQLite 事务提交 → Lance delete 旧 → add 新",崩溃窗口最多留 Lance 孤儿向量(knn 命中无 meta 被宽容跳过)或 knp 暂缺;②`memory://` 每连接独立实例,恰等价 `:memory:` 隔离语义(URI 加 randomUUID);③空库 openTable 抛错 → 惰性建表(首条数据定 schema,免 apache-arrow 显式依赖);④close 必须 await(Windows 句柄释放后才能删目录,同 SQLite EPERM 教训)。
- **用户故事 17 打折**:库从"单文件"变"SQLite 文件 + .lance 目录",备份拷两者。
- **等价性证明**:迁移后 P7 检索抽查 5/5 与 vec0 时代同命中同 score;L2² 距离值逐条一致。

### 29. 浏览器半设置页(方案 B,2026-08-23,用户决策;P6 降级 reversal)

- **范围修订(平台约束)**:api-remotes 的 remote 能力集编译期固定在 dsh 主装配,第三方无法注册新 RPC → 浏览器半**只有 settingsScope wire 一条数据通道**。参数表单(6 个数值字段)全实现;状态卡/同步按钮降级为页面引导文案(继续走 kb_* 工具对话)。
- **props 协议**:slot 组件的 props = inject face 扁平展开(`Partial<Injected>`,见 ui-settings-models 的 ModelsSection)——t 与 host 都由 apply 侧注入,而非框架 props;t(翻译)不经 PropsRuntime/PropsLocale。
- **浏览器半类型纪律**:只 `import type`(erased,purity gate 只拦 value import);namespace 用字符串字面量(客户端 bind spec 接受 string,与服务端 branded 类型不同);schema(schemastery/dsh-settings 依赖)绝不进 client 代码。
- **tsdown 配置自写最小版**:banner/footer 闭包工厂 + external=PLATFORM_MODULES(硬编码自 dsh web/src/platform.ts,升级需同步)+ define(import.meta.env 替换);不用 CSS Modules 故砍掉 lightningcss 插件——组件 inline styles。
- **tsconfig**:`jsx: react-jsx` + `lib` 补 `"DOM"`(无 DOM lib 时 HTMLInputElement 退化为空壳,报莫名的 `value 不存在`)。
- **热更新闭环**:Host 半 `ctx.get('settings')` 可选挂载(裸 loader 场景回退 cordis config),`scope.watch` 把用户层覆盖 `Object.assign` 进 runtime 对象(引用不变);集成测试锁定 topK 6→1 检索立即生效。
- **产物路由验证**:`/plugins/dsh-plugin-aomerag/client.js` 由 host 按 `dsh.client` 声明自动挂载(link: 装的插件直达项目 lib/)。

### 30. 浏览器半两运行时坑(真机暴露,typecheck 与测试缝均拦不住,2026-08-23)

- **slot 注册的第二参数必须是包装工厂**:`register({...}, () => createElement(Comp, { t, host }))`——直接传组件时,outlet 喂的是框架 runtime props,注入 face 全 undefined(组件守卫 `return null` → 整页空白)。`Partial<Injected>` 万金油类型使 typecheck 放行。参照 dshmarket 编译产物定案。
- **controller 方法引用传参丢 this**:`useSyncExternalStore(host.subscribe, host.getSnapshot)` 把方法引用作回调,严格模式内部调用 `this === undefined` → `this.store` 抛 TypeError(被 slot 错误边界捕获 → 页面空)。箭头包装绑定:`(cb) => host.subscribe(cb)` / `() => host.getSnapshot()`。
- 教训:浏览器半的行为验证**必须真机**(dsh web 实际渲染),vitest 的工具缝与 tsc 对这两类错误零感知。

### 31. settings 命令通道模式(2026-08-23,状态/按钮的官方通道实现)

- **模式**:状态 = 独立 namespace(`aomerag-status`)快照(启动与同步开始/结束时 Host 写入);命令 = `aomerag-command` 节 `{action, nonce}`(浏览器两步 set:action 先落旧 nonce 被忽略,nonce 后落才触发——写队列串行保证);Host watch 执行,互斥(busy 忽略新命令),完成后清回 action='none'。
- **schemastery 可空坑**:可选字段(`required(false)`)**不接受 null**——含 null 的 update 整体校验失败且被 catch 吞成 warn,症状是快照"永远不更新"。「未同步」用空串 + 空报告对象表示。
- **异步写时序**:publishStatus 是 void 异步;测试断言前必须轮询(等 update 落定),不能 ingest 完立即读。
- **部署字段热更边界**:mdDir/dbPath 在 apply 时锁定 boot 快照(表单改动重启生效),运行期一律用 boot——热切库(重开 SQLite+Lance)的复杂度与并发风险不值;url/model 热更走 Embedder 指纹缓存重建。

### 32. cordis 动态 get vs 声明式 inject:异步服务上的静默时序坑(2026-08-23)

- **症状链**:浏览器侧三 scope 全 unavailable(状态"读取中"、按钮灰、表单无值),而工具链正常、schema 最小复现正常、官方页面正常。
- **根因**:`ctx.get('settings')` 在 apply 时动态读——FileSettingsProvider 有异步 init(读 settings.yaml),publish 完成前服务尚不可 injectable,get 返回 undefined,settings 注册块被"无服务"分支**静默跳过** → describe 无我们的 namespace → 浏览器 load 落入 unavailable 分支(settings-scope.ts 的 `view === undefined`)。
- **修法**:注册块包进 `ctx.inject(['settings'], (sctx) => {...})`——声明式注入,服务就绪即触发;服务缺席时静默不触发,恰好是可选依赖语义(裸 loader 组合不挂 provider 也不炸)。
- **同族教训**(与 #20 ctx.effect 并列):cordis 生命周期 API 的"动态读"在异步初始化的服务/资源上会静默拿到空,优先声明式。
- **诊断技巧**:官方页面(Models)不是 settings wire 的探针(它走 credentials/llm API)——鉴别 settings wire 应用 General 页的 Language 行(locale namespace);或最小复现 register+describe(本条即由此排除 schema 嫌疑)。

### 33. dsh 0.1.1-rc.2 → 0.1.6-alpha.2 升级记录(2026-09-20,checkout 重装事故的全面适配)

- **背景**:dsh checkout 被删除重 clone(HEAD 从 0.1.1-rc.2 时代跳到 0.1.6-alpha.2),插件"无法使用且零报错"。三个独立故障叠加:
  1. **加载链静默死亡**:`vendor/cordis/bin.js` 把 `@deepseek-ai/cordis-plugin-include` 作为条目挂载,loader 从 `ctx.baseUrl`(= cwd,项目根)解析裸包名——该包只是 vendor 的私有依赖,项目 node_modules 没有 → include 条目 import 失败,cordis.yml 里的插件一个都没加载。修法:devDeps 加 `@deepseek-ai/cordis-plugin-include@1.0.7`(与 vendor/include 同源)。
  2. **错误不可见**:cordis 4 LoggerService 默认 exporter 只写内存 buffer 不接 console——info/warn/error 全静默。排查手段:复刻 bin.js 流程后定时 dump `ctx.logger.buffer`(Error 的 message/stack 不可枚举,`JSON.stringify` 只剩 `{code}`,须逐个 `e.message` 提取)。
  3. **client 包消失**:`packages/client/runtime` 不存在了(npm 也停在 rc.2),symlink 死链 → typecheck 红。
- **API 变化面(实际触到的)**:
  - `settingsNamespace` **删除**——它只用于 brand 三个命名空间字符串;改普通字符串常量,`ctx.settings.register` 运行时校验 `/^[a-z][a-z0-9-]*$/`。register 签名本身零漂移(`base` option 与返回的 get/watch/update 保留;applies/validate 为加法)。
  - `CallId` → `ToolCallId`(dsh-llm brand 改名,无别名,ESM 具名导入硬失败)。注意 spike/ 不在 tsconfig include,这三处改名 **tsc 看不见**,只能靠 loader 冒烟验证。
  - `ctx.tools.execute` 输入 `{callId,name,arguments,signal}` 与结果 `isError/value/error` 判别联合**零漂移**;`defineTool` 的 `output:{schema,render}` 在 0.1.6 是强制且被强制校验(项目 #22 时代已写,兼容),parameters 根为隐式 open object。
  - client 半:`ClientContext` 类型消失——官方样板写法 `import type { Context as ClientContext } from '@deepseek-ai/cordis'` + type-only import 汇入各 service 声明;**`ctx.slots` 的声明在 `dsh-client-ui-renderer/client`**(漏了会报 slots 不存在);`SettingsScope` 新家 `dsh-client-ui-settings/client`(snapshot 增加 base/user/revision/mode 字段,纯加法;subscribe/getSnapshot/set 原样)。
  - `PLATFORM_MODULES` 表变化(+`dsh-client-store`/`+ui-dockkit`,−`web-react`/`-ui-attachment`/`-schema-form`)——tsdown external 照抄新表;`dsh.client.inject` 语义 = 信息性包名边(runtime 条目换 `dsh-client-connection`),模块表请求用 `dsh.client.external`。
- **版本纪律**:0.1.6 全线在 npm 但 `latest` dist-tag 停滞在 0.0.1-rc.x——**必须 exact pin**(或 `^0.1.6-alpha.2`,caret 对 prerelease 只匹配同 [maj.min.patch] 元组);0.1.6 包 peer 要求 cordis ^4.0.2、schemastery ^3.18.2。
- **适配结果**:89 测试 + live 5 + typecheck + loader 冒烟 + spike-d + 集成级验收(1155 docs 库零重灌、二次同步全 skip、检索抽查 5/5)全绿;真机浏览器清单(P4)见计划文档。

### 34. 对抗式审查 R1–R24 处置记录(2026-09-21,24 条全处置)

报告:`docs/code-review-2026-09-21.md`(CRITICAL 1 / HIGH 10 / MEDIUM 10 / LOW 3)。处置分 9 个批次提交,契约增补见 plan.md §2(2026-09-21 批注)。

- **参数闸门(R1/R2/R13/R19/R24)——三层收口,拒绝型 schema 是坑**:`FileSettingsProvider.register` 在注册时**同步 resolve** 整个命名空间(`resolve = schema(mergeLayers(base, section))`),schemastery 对历史持久化非法值直接 throw——纯 `.min(1)` 会让老用户的 settings 注册炸掉且 cordis 静默 logger 下不可见。故 settings 层用 **clampedInt 钳制转换 schema**(0/负数/超大/字符串/null 全部收敛到安全区间,永不抛),cordis 部署层保持严格 min/max(spec #21 加载期响亮失败),工具面 `top_k`(LLM 直传参数,不在 schema 闸内)在 `core.search` 入口钳 [1,100]。边界单源 `tunable.ts LIMITS`。附:`z.transform(z.any(), cb).default(def)` 中 **default 必须显式链**——缺失键不会进 transform 回调,整键缺失。
- **R5 检索崩溃**:入库侧 tokenize 输出是数据、查询侧同一输出被当 FTS5 语法解析是根因;`toFtsMatchQuery` 逐 token 双引号短语字面量 + 空查询短路。注意 dsh-tools 的 `integer` 参数校验在工具层上游拒浮点(top_k=2.7 不进 execute),钳制面只需覆盖整数。
- **R3/R4 同为 syncDir 清理语义的两种翻车**:清理以「本次扫描集」为基准 → 对第二个目录 ingest = 整库替换(入口 resolve 白名单至配置目录,win32 大小写不敏感比较);rebuild 先 `prune([])` = 已删文件登记行消失、清理循环永远够不着(改 force 语义:登记行保留、仅绕过 sha 短路,**重建报告口径 added→updated**)。
- **R6/R16/R17 同域生命周期**:runSync 单飞互斥(state.syncing 首个 await 前同步置位);busy 命令响亮拒绝 + 即时回清(旧实现的 finally nonce 回卷"恰好"也清通道——测试需判别点「回清时同步仍在进行」,否则两实现都过);崩溃残留命令在挂 watch 前复位并把残留 nonce 记为已消费。
- **R7 孤儿 GC 的测试坑**:Lance Table 对象是 MVCC 快照视图,**长持连接看不到外部连接后加的行**——模拟孤儿必须走「灌库 → close → 外部连接注入 → 重开」的崩溃-重启流程,同进程注入对 store 不可见(会把测试写成假绿)。
- **R11 部署字段出表单**:mdDir/dbPath 的表单「重启生效」从未真实生效(boot 只读 cordis 层,settings 用户层无回灌)——虚假承诺比没有承诺更糟,部署字段回归 cordis.yml 唯一入口,状态区只读展示。**同根的 syncOnStart 开关也是死的**(boot 读 cordis 层):启动同步决策移入 settings inject 块读合并值,行为边界 = settings 服务不可用的裸 cordis 环境不再自动同步。
- **R12 定界缓解**:renderSearch 头部数据定界声明(检索语料是不可信输入,防 FTS 稳定召回的投毒链);R3 的 dir 白名单使该链的破坏力从「整库替换」降为「无效调用」。
- **R23 不修**:命令两步 set 是平台 wire 逐 key 的结构限制(UI 禁用窗口 + nonce 栅栏兜底),写后读校验重试属过度工程,记为已知限制。
- **R10 的 allowBuilds 格式**:dsh `build-approval.ts` 消费 YAML mapping(`allowBuilds: { better-sqlite3: true }`),`setIn(['allowBuilds', name], true)`;旧文档的 pnpm ≤10 `onlyBuiltDependencies` 列表写法使 CLI 用户的 better-sqlite3 构建永久 blocked。
