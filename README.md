# dsh-aomerag

deepseek-harness(dsh)知识库插件:把 AomeRAG(Python Agentic RAG)的「切片 → 向量化 → 混合检索」管线移植为独立 TypeScript 插件。`.md` 文件放入知识目录即自动增量同步;agent 经 `kb_search` / `kb_ingest` / `kb_status` 工具检索与重灌,命中带来源(文档、标题路径、分数)。

> 文档:[需求 spec](docs/spec.md) · [技术 spike 结论](docs/spike.md) · [实施计划](docs/plan.md) · [安装指南](INSTALL.md)
>
> **Web 设置页**:dsh web 设置 → 「AomeRAG 知识库」——9 项参数表单(保存即热更新)+ 库状态快照(文档/chunk/同步报告/体积/知识目录与库路径)+ 操作按钮(立即同步/重建索引/清空库/打开目录)。知识目录与库路径是部署字段,只读展示,修改走 cordis.yml。

## 环境前提

- Node 24+(原生 type stripping 直跑 `.ts`,无需 tsx)+ pnpm 11
- dsh 运行环境(本机开发用 checkout:`D:\GitHub\deepseek-harness`);**插件依赖已全部来自公共 npm 源**(`cordis ^4.0.1` + `dsh-* ^0.1.1-rc.2`,`@deepseek-ai` 官方源由 `.npmrc` 强制),不需要 link: 本地解析
- Ollama:`bge-m3`(1024 维);备选 `qwen3-embedding:4b`
- 蓝本项目与验收语料:`D:\Code\AomeCode`(其 `raw/md-data`)

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm test` | unit + integration 两档(vitest,默认) |
| `pnpm test:live` | live 档:真 Ollama 集成测试(对应 AomeRAG 的 `-m live` 惯例) |
| `pnpm typecheck` | `tsc --noEmit` |
| `node spike/spike-a-sqlite-vec.ts` | 复现 spike(另有 `-b`/`-c`/`-d`;一次性验证脚本,不进 src/) |

## 在 dsh 中加载插件(本地开发)

**推荐:profile 安装**(2026-08-23 起依赖全 npm,本机已实测):

```sh
# 在 dsh 安装目录执行;插件声明了 dsh.bundle,自动注册进 profile 层栈
pnpm dsh plugin --profile web add link:D:/Code/AomeRAG
```

配置与 preset 见 [INSTALL.md](INSTALL.md)。备选(裸 loader 组合,`link:` 时代的旧模式仍可用):

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

## 分享给别人(GitHub 私有仓库)

**依赖已全部来自公共 npm 源**(宿主包 `cordis ^4.0.1` + `dsh-* ^0.1.1-rc.2`;`@deepseek-ai` 官方源由仓库 `.npmrc` 强制,国内镜像不影响)——对方**不需要 dsh 源码 checkout**。完整安装步骤见 **[INSTALL.md](INSTALL.md)**,一句话概览:

```sh
dsh plugin --profile web add github:<你的私有仓库>/AomeRAG
```

对方唯一需要手动安装的第三方是 **Ollama + bge-m3**(INSTALL.md 含 Windows 步骤);向量库(LanceDB)与中文 FTS 随 npm 依赖自动安装。

### 交付者清单

1. **建私有仓库并推送**:本项目 git 已初始化(全部历史在本地),`git remote add origin <私有仓库地址> && git push -u origin main`
2. **preset 已随仓库**:`presets/aome-rag/` 在仓库内,对方拷到 `~/.dsh/.agent-presets/` 即获得 dsh web 首页 RAG 入口
3. **(可选)带已灌库跳过首灌**:`data/acceptance.sqlite` + `data/acceptance.lance/`(1155 文档 / 9097 chunks,gitignore 内需另行拷贝)——对方 `dbPath` 指向 sqlite 文件(Lance 目录同名自动识别),秒级就绪

## 配置

全部可调参数走 cordis.yml 的 config(带默认值,以 `src/config.ts` 的 Schemastery Config schema 为准):知识目录、库文件路径、Ollama 地址与模型、embedding 维度、chunk 三参数、top_k、RRF 常数、批量大小、启动同步开关。默认值对齐 AomeRAG。

## 存储形态与历史坑

**当前(2026-08-23 起,LanceDB A 方案)**:向量在 LanceDB 目录(同名 `.lance`,默认暴力扫描,9097 条 16.7ms;几十万条时可建 IVF-PQ 索引),元数据/FTS5/文件登记在 SQLite。跨库无原子事务(顺序:SQLite 提交 → Lance 删旧加新,崩溃窗口由宽容对齐兜底)。

**历史(sqlite-vec 时代,已退役)**:vec0 显式 `rowid` 绑定插入报错 → 自动 rowid + `last_insert_rowid()` 回填;KNN `JOIN ... LIMIT` 报错 → LIMIT 直接约束 vec0 子查询。两坑随 vec0 虚拟表退役,详见 [docs/spike.md](docs/spike.md) Spike A/E 与 [docs/porting-notes.md](docs/porting-notes.md) #28。
