// kb_search / kb_ingest / kb_status 的 defineTool 定义。
// 依赖注入 KbCore(由 index.ts 装配),本模块纯声明——契约见 docs/plan.md §2 工具契约。

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { SyncReport } from './sync.ts'
import type { Hit } from './retriever.ts'

export interface KbSearchResult {
  hits: Hit[]
  status: 'ok' | 'syncing' | 'empty'
}

export interface KbStatusResult {
  docs: number
  chunks: number
  lastSyncAt: string | null
  syncing: boolean
  dbPath: string
  model: string
}

/** 工具层的最小核心面(index.ts 用 store/embedder/sync 状态实现)。 */
export interface KbCore {
  search(query: string, topK?: number): Promise<KbSearchResult>
  ingest(dir?: string): Promise<SyncReport>
  status(): KbStatusResult
}

export interface KbTools {
  search: ToolDefinition
  ingest: ToolDefinition
  status: ToolDefinition
}

const renderSearch = (value: { status: string; hits: Hit[] }): string => {
  if (value.status === 'empty') return '知识库无命中——可能尚未完成同步(kb_status 查看状态),或确实没有相关内容。'
  const head = value.status === 'syncing' ? '知识库同步进行中,以下为已入库部分:\n' : ''
  const lines = value.hits.map(
    (h, i) => `[${i + 1}] ${h.sourceDoc} > ${h.headingPath} (score ${h.score.toFixed(4)})\n${h.content}`,
  )
  return head + lines.join('\n\n')
}

const renderReport = (value: SyncReport): string => {
  const summary = `同步完成:新增 ${value.added} · 更新 ${value.updated} · 跳过 ${value.skipped} · 删除 ${value.removed} · 失败 ${value.failed}`
  if (value.failed === 0) return summary
  return `${summary}\n失败明细:\n${value.errors.map((e) => `- ${e}`).join('\n')}`
}

const renderStatus = (value: KbStatusResult): string =>
  [
    `文档数: ${value.docs}(chunk ${value.chunks})`,
    `最后同步: ${value.lastSyncAt ?? '(尚未同步)'}`,
    `状态: ${value.syncing ? '同步中' : '空闲'}`,
    `库文件: ${value.dbPath}`,
    `模型: ${value.model}`,
  ].join('\n')

export function createKbTools(kb: KbCore): KbTools {
  return {
    search: defineTool({
      name: 'kb_search',
      description: '检索本地知识库(.md 文档),返回带来源(文档、标题路径、分数)的命中片段。中英文均可。',
      parameters: {
        query: { type: 'string', required: true, description: '检索词,自然语言或关键词' },
        top_k: { type: 'integer', description: '返回命中数,默认按配置(6)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            hits: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  sourceDoc: { type: 'string', required: true },
                  headingPath: { type: 'string', required: true },
                  content: { type: 'string', required: true },
                  score: { type: 'number', required: true },
                },
              },
              required: true,
            },
            status: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
      },
      // 只读检索(SQLite 同连接查询在单线程内天然串行),可与其他工具调用并行
      isConcurrencySafe: () => true,
      async execute(args) {
        return kb.search(args.query, args.top_k)
      },
    }),

    ingest: defineTool({
      name: 'kb_ingest',
      description: '增量同步知识库目录:扫描 .md 文件,只处理新增/变更,清理已删除。用户更新文档后调用,无需重启。',
      parameters: {
        dir: { type: 'string', description: '知识目录,缺省用配置目录' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            added: { type: 'integer', required: true },
            updated: { type: 'integer', required: true },
            skipped: { type: 'integer', required: true },
            removed: { type: 'integer', required: true },
            failed: { type: 'integer', required: true },
            errors: { type: 'array', items: { type: 'string' }, required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderReport(value) }],
      },
      async execute(args) {
        return kb.ingest(args.dir)
      },
    }),

    status: defineTool({
      name: 'kb_status',
      description: '查看知识库状态:文档数、chunk 数、最后同步时间、是否同步中、库文件与 embedding 模型。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            docs: { type: 'integer', required: true },
            chunks: { type: 'integer', required: true },
            lastSyncAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            syncing: { type: 'boolean', required: true },
            dbPath: { type: 'string', required: true },
            model: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
      },
      isConcurrencySafe: () => true,
      async execute() {
        return kb.status()
      },
    }),
  }
}
