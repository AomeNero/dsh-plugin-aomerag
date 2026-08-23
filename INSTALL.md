# dsh-aomerag 安装指南(最终用户)

> 面向已使用 deepseek-harness(dsh)的用户。插件依赖全部来自公共 npm 源,安装不需要 dsh 源码 checkout。

## 前置条件

| 依赖 | 检查 | 说明 |
|---|---|---|
| Node 24+ / pnpm 11+ | `node -v` / `pnpm -v` | 插件为原生 TS 直跑,需 Node 24 |
| dsh 已安装并初始化过 profile | 你已能用 `dsh web` / `dsh --profile …` | 本指南不覆盖 dsh 本体安装 |
| **Ollama + bge-m3** | `curl http://127.0.0.1:11434/api/tags` | **唯一需要手动安装的第三方** |
| 私有仓库访问权 | `git ls-remote <仓库地址>` 能列出引用 | git 凭据(HTTPS token 或 SSH)配好即可,pnpm 走 git 协议拉取 |

### 安装 Ollama 与模型(唯一的手动第三方步骤)

```sh
# 1. 安装 Ollama(Windows):https://ollama.com/download 下载安装包,或 winget:
winget install Ollama.Ollama

# 2. 拉取 embedding 模型(bge-m3,1024 维,约 1.2GB)
ollama pull bge-m3

# 3. 验证
curl http://127.0.0.1:11434/api/tags
```

> 向量库(LanceDB)、SQLite、中文全文检索(FTS5)**全部随插件 npm 依赖自动安装**,无需任何手动步骤。

## 安装插件

```sh
# 在 dsh 安装目录执行(与 dsh 命令同级);<repo> 换成私有仓库地址,如 github:your-org/aomerag
dsh plugin --profile web add github:your-org/aomerag
# 无 UI 场景可再装 headless:dsh plugin --profile headless add github:your-org/aomerag
```

安装会自动从 npm 拉取全部依赖(`@deepseek-ai` 官方源已由仓库 `.npmrc` 强制,国内镜像不影响)。

### profile 构建配置(两个必配项)

编辑 `~/.dsh/profiles/web/pnpm-workspace.yaml`(没有则新建):

```yaml
autoInstallPeers: false        # 宿主契约包由 dsh 运行时提供,不从 profile 树重复安装
onlyBuiltDependencies:
  - better-sqlite3             # 原生模块构建审批
```

配置后在该目录重跑一次 `pnpm install`(或重装插件)使其生效。

### 写入配置

编辑 `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: dsh-aomerag
  config:
    mdDir: 'D:/知识目录'        # 存放 .md 源文件的目录(递归扫描)
    dbPath: 'D:/任意路径/kb.sqlite'  # 库文件(向量在同名 .lance 目录,自动生成)
    ollamaBaseUrl: 'http://127.0.0.1:11434'
    embedModel: 'bge-m3'
    embedDim: 1024
    syncOnStart: true           # 启动自动增量同步(首次全量,之后秒级)
```

全部字段与默认值见仓库 README「配置」一节。

### 在 web 界面调整参数

dsh web **设置 → AomeRAG 知识库**:11 项参数表单(切片/检索参数与 Ollama 地址、模型热更新;知识目录与库路径标注「保存后重启生效」)、库状态快照(文档数/chunk 数/最后同步/同步报告/库体积)与四个操作按钮(立即同步/重建索引/清空库/打开知识目录)。状态为快照式,同步事件自动刷新;对话通道(kb_status/kb_ingest)保持可用。

## 首次灌库与验证

1. 把 `.md` 文件放进 `mdDir`(支持子目录;`images/` 与 `~` 开头临时文件自动跳过)
2. 启动 dsh web,对 agent 说:**「查一下知识库状态」** → 应看到 kb_status 返回(首次同步进行中时 docs 会持续增长)
3. 灌库完成后问:**「从知识库查一下 XXX」** → 模型调 kb_search,回答带出处(源文档 > 标题路径)

> 首灌耗时参考:1155 个文档 / 约 9000 chunks / 本地 bge-m3 约 50 分钟(一次性;此后增量同步秒级)。跳过首灌:向交付者索要已灌的 `kb.sqlite` + `kb.lance/` 目录,直接放到 `dbPath` 指向的位置。

## 可选:知识库问答 preset(dsh web 首页 RAG 入口)

```sh
# 仓库内 presets/aome-rag 拷到 dsh 的 preset 目录
cp -r presets/aome-rag  ~/.dsh/.agent-presets/
```

之后 dsh web 首页新建会话可选 **aome-rag** 预设——专职 AomeRAG 知识库问答助手(回答前先检索、注明出处、无命中不编造)。

## 故障排查

| 症状 | 原因与处理 |
|---|---|
| 安装时 `@deepseek-ai` 包拉取失败 | 仓库 `.npmrc` 已强制官方源;若仍失败检查代理。旧版本插件需手动配,新版本已内置 |
| `better-sqlite3` 报原生绑定错误 | profile 的 `onlyBuiltDependencies` 未配(见上),配后重跑 `pnpm install` |
| 启动同步失败「知识目录不存在」 | `mdDir` 路径写错或未创建;目录必须先存在 |
| kb_search 报「Ollama 不可达」 | Ollama 未启动或 `ollamaBaseUrl` 不对;确认 `curl http://127.0.0.1:11434/api/tags` |
| kb_search 报「维度不符」 | `embedModel` 与 `embedDim` 不匹配(bge-m3 必须 1024);或 dbPath 指向了用其他维度模型灌过的旧库 |
