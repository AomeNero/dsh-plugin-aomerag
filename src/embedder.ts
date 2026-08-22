// Ollama embedding 客户端(spike C 定案):POST /api/embed 批量端点,一次请求一批文本。
// 错误处理:HTTP 状态 + body.error 字段响亮抛出;维度对每条响应校验(与配置不符即抛)。

export interface EmbedderOptions {
  baseUrl: string
  model: string
  dim: number
}

const getErrorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

export class Embedder {
  private readonly baseUrl: string
  private readonly opts: EmbedderOptions

  constructor(opts: EmbedderOptions) {
    this.opts = opts
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
  }

  /** 批量单请求;返回与 texts 下标对齐的向量数组。 */
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.opts.model, input: texts }),
      })
    } catch (e) {
      throw new Error(`Ollama 不可达(${this.baseUrl}):${getErrorMessage(e)}`)
    }

    const text = await res.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = undefined
    }
    const errorDetail =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : text.slice(0, 200)

    if (!res.ok) {
      throw new Error(
        `Ollama /api/embed HTTP ${res.status}${errorDetail ? `: ${errorDetail}` : ''}`,
      )
    }

    const embeddings = (data as { embeddings?: unknown } | undefined)?.embeddings
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new Error(
        `Ollama /api/embed 响应格式错:期望 ${texts.length} 条 embeddings,实得 ${
          Array.isArray(embeddings) ? embeddings.length : '非数组'
        }`,
      )
    }

    return embeddings.map((e, i) => {
      if (!Array.isArray(e) || e.length !== this.opts.dim) {
        throw new Error(
          `embedding 维度不符:期望 ${this.opts.dim},实得 ${
            Array.isArray(e) ? e.length : '非数组'
          }(模型 ${this.opts.model},第 ${i + 1} 条文本)`,
        )
      }
      return Float32Array.from(e as number[])
    })
  }

  /** 启动健康检查:embed 通道完全可用(服务在线 + 模型存在 + 维度匹配)才为 true。 */
  async ping(): Promise<boolean> {
    try {
      await this.embed(['ping'])
      return true
    } catch {
      return false
    }
  }
}
