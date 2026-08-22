# P7 端到端验收记录(2026-08-22/23)

> 环境:Windows 10 · Node 24 · 真 Ollama bge-m3(1024 维,本机 CPU/GPU)· dsh checkout @ 0.1.0-rc.7
> 复现:`cd spike/acceptance && node D:\GitHub\deepseek-harness\vendor\cordis\bin.js`(脚本 `spike/acceptance.ts`)

## 结果

| 项 | 结果 | 结论 |
|---|---|---|
| 真语料全量首灌 | 1155/1155 文件成功、0 失败,9097 chunks,2966.5s(≈49 分钟) | ✅ |
| kb_status | docs=1155, chunks=9097, lastSyncAt, dbPath, model 全对 | ✅ |
| 增量重灌 | 二次同步 **1.2s**,1155 全 skipped(零 embedding 调用) | ✅ |
| 检索质量抽查 | 5/5 组首命中;headingPath 精确到文档内部模块;2 组双通道 rank1 满分(score=2/61) | ✅ |
| 测试覆盖率 | 语句 97.9%(门槛 80%) | ✅ |
| dsh 聊天实测(模型自主调 kb_search/kb_ingest) | **待用户手动执行**(需 DEEPSEEK_API_KEY,见下) | ⏳ |

## 性能观察(记录,非缺陷)

- 首灌吞吐 ≈ 3 chunk/s,远低于 spike C 短文本基准(33/s):真实 chunk 为 ~1200 字长文本,bge-m3 长文本推理慢得多,叠加 1155 次串行文件级往返。一次性成本,增量同步 1.2s 无感。
- v2 若需优化:文件级并行(embed 批内仍串行)或 chunk target 调小;注意 plan 风险表约束(不压垮本地 Ollama)。

## 检索抽查明细

| 查询 | 首命中 | score |
|---|---|---|
| PG361 电源管理 限流告警 | 上层软件知识库/罗杨/UIS_LCS_MD/r41319.md(电源程序升级文档,FTS 通道强命中) | 0.0164 |
| MIPI Lane 配置 初始化 | 点屏/SSD2832应用笔记(C-PHY)> 流程总结 | 0.0164 |
| 老化炉操作 SOP | 上层软件知识库/彭江/2309DDEHD3277越南老化炉操作SOP.md | 0.0328 |
| Lua 字符串处理 表格操作 | PG361_API_Reference.md > ADDP - Lua辅助工具模块 | 0.0164 |
| GPIO PWM 频率测量 | PG361_API_Reference.md > GPIO - GPIO引脚控制模块 | 0.0323 |

## 聊天链路手动验收步骤(需 DEEPSEEK_API_KEY)

1. dsh checkout 根目录建 `.env`:`DEEPSEEK_API_KEY=sk-…`(可选 `DEEPSEEK_BASE_URL`)
2. 你的 dsh 运行目录 `cordis.yml` 加插件行(复用已灌库,秒级就绪):

   ```yaml
   - name: 'file:///D:/Code/AomeRAG/src/index.ts'
     config:
       mdDir: 'D:/Code/AomeCode/raw/md-data'
       dbPath: 'D:/Code/AomeRAG/data/acceptance.sqlite'
       syncOnStart: false   # 库已就绪;true 亦无害(增量 1.2s)
   ```

3. 启动 dsh web(或 headless profile),聊天提问:「知识库里 PG361 的 GPIO PWM 接口怎么用?」→ 预期:模型调 `kb_search`,回答引用来源(文档/标题路径/分数)
4. 改动一个 md 后对 agent 说「我更新了文档,重新导一下」→ 预期:模型调 `kb_ingest`,报告 `updated: 1`
