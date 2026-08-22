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
