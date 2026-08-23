# dsh-aomerag

deepseek-harness(dsh)知识库插件:把 AomeRAG(Python Agentic RAG)的「切片 → 向量化 → 混合检索」管线移植为独立 TypeScript 插件。`.md` 文件放入知识目录即自动增量同步;agent 经 `kb_search` / `kb_ingest` / `kb_status` 工具检索与重灌,命中带来源(文档、标题路径、分数)。

> 文档:[需求 spec](docs/spec.md) · [技术 spike 结论](docs/spike.md) · [实施计划](docs/plan.md)

## 环境前提

- Node 24+(原生 type stripping 直跑 `.ts`,无需 tsx)+ pnpm 11
- dsh 源码 checkout:`D:\GitHub\deepseek-harness`(npm 上的 rc 包依赖残缺,**必须用 `link:` 指向本地包目录**)
- Ollama:`bge-m3`(1024 维);备选 `qwen3-embedding:4b`
- 蓝本项目与验收语料:`D:\Code\AomeCode`(其 `raw/md-data`)

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm test` | unit + integration 两档(vitest,默认) |
| `pnpm test:live` | live 档:真 Ollama 集成测试(对应 AomeRAG 的 `-m live` 惯例) |
| `pnpm typecheck` | `tsc --noEmit` |
| `node spike/spike-a-sqlite-vec.ts` | 复现 spike(另有 `-b`/`-c`/`-d`;一次性验证脚本,不进 src/) |

## 在 dsh 中加载插件

依赖按 spike D 定案以 `link:` 模式指向本地 dsh checkout(原生模块构建审批在 `pnpm-workspace.yaml`):

```sh
pnpm add link:D:/GitHub/deepseek-harness/vendor/cordis \
         link:D:/GitHub/deepseek-harness/vendor/include \
         link:D:/GitHub/deepseek-harness/vendor/loader \
         link:D:/GitHub/deepseek-harness/vendor/schemastery \
         link:D:/GitHub/deepseek-harness/packages/core/tools \
         link:D:/GitHub/deepseek-harness/packages/core/system-prompt \
         link:D:/GitHub/deepseek-harness/packages/llm/llm
```

无 UI 快速验证(cordis loader 读 cwd 的 `cordis.yml`):

```sh
cd <含 cordis.yml 的目录>
node D:\GitHub\deepseek-harness\vendor\cordis\bin.js
```

`cordis.yml` 的 Windows 绝对路径插件行必须写 `file:///D:/...` URL(裸 `D:/...` 报 protocol 错):

```yaml
- name: '@deepseek-ai/dsh-system-prompt'
- name: '@deepseek-ai/dsh-tools'
- name: 'file:///D:/Code/AomeRAG/src/index.ts'
```

Web UI 场景:`pnpm dsh web --patch`。

## 分享插件给别人

v1 不发布 npm(spec Out of Scope):dsh 的 rc 包在 npm 上依赖残缺(`dsh-type-meta` 未发布,`link:` 本地解析是定案,见 [docs/spike.md](docs/spike.md) Spike D)。因此分享 = 转移整个项目目录 + 对方自备 dsh 源码 checkout。

### 对方需要准备

| 依赖 | 说明 |
|---|---|
| Node 24+ / pnpm 11+ | 原生 type stripping 直跑 `.ts` |
| dsh 源码 checkout | clone deepseek-harness 到任意目录,版本与插件开发所用一致最稳(rc 阶段 API 有破坏性变更风险) |
| Ollama + bge-m3 | `ollama pull bge-m3`(1024 维)。**必需依赖**:检索(查询向量)与入库都要它;换模型/维度则已灌库不兼容(维度校验会在启动即响亮报错) |

### 步骤(官方 profile 安装路径,本机已实测)

1. **交付项目**:git 推到内部仓库(推荐,项目已 gitignore `node_modules/`、`data/`、`coverage/` 等生成物),或直接拷贝目录
2. **对方改 `link:` 路径**:`package.json` 里所有 `link:D:/GitHub/deepseek-harness/...` 指向自己的 checkout(路径用正斜杠):

   ```powershell
   # PowerShell 批量替换
   (Get-Content package.json) -replace 'D:/GitHub/deepseek-harness', 'D:/你的路径/deepseek-harness' | Set-Content package.json
   ```

   > `peerDependencies` 里的 4 个宿主契约包(`@deepseek-ai/{cordis,dsh-llm,dsh-system-prompt,dsh-tools}`)版本号对齐你的 dsh checkout 版本(当前 `^0.1.0-rc.7`);宿主运行时提供实现,清单不自带副本。

3. **安装到 profile**(在 dsh checkout 根目录执行;插件已声明 `dsh.bundle`,自动注册进层栈):

   ```sh
   pnpm dsh plugin --profile web add link:D:/你的路径/AomeRAG
   # 无 UI 一次性验证可再装 headless:pnpm dsh plugin --profile headless add link:D:/你的路径/AomeRAG
   ```

4. **写配置**(profile 的 `cordis.patch.yml`,按 id 覆盖默认值;文件在 `$DSH_HOME/profiles/web/`,Windows 即 `~/.dsh/profiles/web/`):

   ```yaml
   - id: dsh-aomerag
     config:
       mdDir: 'D:/知识目录'
       dbPath: 'D:/你的路径/AomeRAG/data/kb.sqlite'
       ollamaBaseUrl: 'http://127.0.0.1:11434'
       embedModel: 'bge-m3'
       embedDim: 1024
       syncOnStart: false
   ```

5. **验证**:`pnpm dsh --profile web --dump-config` 应出现 `id: dsh-aomerag` 行;启动 `pnpm dsh web` 后对 agent 说「查一下知识库状态」→ 预期模型调 `kb_status` 返回文档数

> 备选(不起 profile 的裸组合):任何含 `cordis.yml` 的目录,插件行写 `- name: 'file:///D:/你的路径/AomeRAG/src/index.ts'` + `config:`,然后 `node D:\GitHub\deepseek-harness\vendor\cordis\bin.js`(项目根的 `cordis.yml` 即此模式,指向 spike 冒烟脚本)。

### 技巧:直接携带已灌库,跳过 49 分钟首灌

库是**单个自包含 SQLite 文件**(向量 + FTS 索引 + 文件登记表都在里面,备份即拷贝)。把 `data/acceptance.sqlite`(本项目验收已灌 1155 文档 / 9097 chunks,约 45MB)随项目一起交付,对方 `dbPath` 直接指向它 + `mdDir` 指向同一份语料目录即可——`syncOnStart: true` 也只会做秒级增量校验(sha 全部命中,零 embedding 调用)。

> 注意:库文件在 `.gitignore`(二进制生成物),git 交付需另行拷贝;且携带的库已绑定灌库时的语料内容,对方修改语料后会正常走增量更新,无需重新全量。

### 可选:知识库问答 preset(首页 RAG 入口)

`presets/aome-rag/` 是一个交付模板:装好后 **dsh web 首页新建会话即可选 "aome-rag" 预设**——身份为 AomeRAG 知识库问答助手(回答前先 `kb_search` 检索、注明出处、无命中不编造)。它只改 persona,`kb_*` 工具复用上一步装进 profile 的插件实例(agent 视图继承全局注册),单实例无冲突。

```sh
# 安装:拷贝到对方的 dsh preset 目录(user trust root,实时扫描,无需重启)
cp -r presets/aome-rag  ~/.dsh/.agent-presets/
```

前提:插件已按上面步骤装进 profile——preset 自身不挂插件,没有 host 面的 kb_* 工具它就只是一个 persona。验证:首页选 aome-rag,问「知识库里 PG361 的 GPIO PWM 接口怎么用」。

## 配置

全部可调参数走 cordis.yml 的 config(带默认值,以 `src/config.ts` 的 Schemastery Config schema 为准):知识目录、库文件路径、Ollama 地址与模型、embedding 维度、chunk 三参数、top_k、RRF 常数、批量大小、启动同步开关。默认值对齐 AomeRAG。

## 已知坑(sqlite-vec 0.1.9 + better-sqlite3 13.x)

1. vec0 显式 `rowid` 绑定插入报 `Only integers are allowed` → 先插 vec0 自动分配 rowid,事务内 `last_insert_rowid()` 回填元数据表
2. KNN 查询 `JOIN ... LIMIT` 报 `A LIMIT or 'k = ?' constraint is required` → LIMIT 必须直接约束 vec0 子查询

详见 [docs/spike.md](docs/spike.md) Spike A。
