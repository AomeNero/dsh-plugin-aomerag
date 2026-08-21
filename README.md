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

## 配置

全部可调参数走 cordis.yml 的 config(带默认值,以 `src/config.ts` 的 Schemastery Config schema 为准):知识目录、库文件路径、Ollama 地址与模型、embedding 维度、chunk 三参数、top_k、RRF 常数、批量大小、启动同步开关。默认值对齐 AomeRAG。

## 已知坑(sqlite-vec 0.1.9 + better-sqlite3 13.x)

1. vec0 显式 `rowid` 绑定插入报 `Only integers are allowed` → 先插 vec0 自动分配 rowid,事务内 `last_insert_rowid()` 回填元数据表
2. KNN 查询 `JOIN ... LIMIT` 报 `A LIMIT or 'k = ?' constraint is required` → LIMIT 必须直接约束 vec0 子查询

详见 [docs/spike.md](docs/spike.md) Spike A。
