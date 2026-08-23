// 浏览器半入口(方案 B):注册 AomeRAG 设置 section(参数表单)。
// 数据经 ui-settings 的 settingsScope wire(官方 assembly 已挂),无自建 remote(平台约束:
// api-remotes 能力集编译期固定,第三方无法注册新 RPC;状态/操作走 kb_* 工具对话)。
// namespace 字符串须与 src/tunable.ts 的 TUNABLE_NAMESPACE 保持一致('aomerag')。

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { AomeragSection } from './AomeragSection.tsx'
import type { AomeragSectionInjected } from './AomeragSection.tsx'
import { en, zh, type AomeragKey } from './locales.ts'
import type { AomeragTunable } from '../tunable.ts'

export type { AomeragSectionInjected, AomeragSectionProps } from './AomeragSection.tsx'
export type { AomeragKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** AomeRAG 设置页文案。 */
    'settings.aomerag': AomeragKey
  }
}

const NS = 'settings.aomerag'

/** Required services:slots 注册 + settings wire(ui-settings 提供 settingsScope,transport 走 connection/remote)。 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-aomerag: dictionaries')

  const t = ctx.locale.bind(NS)
  const host = ctx.settingsScope.bind<AomeragTunable>({ namespace: 'aomerag' })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'aomerag',
    order: 30,
    label: () => t('nav'),
    inject: (): AomeragSectionInjected => ({ t, host }),
  }, AomeragSection))
}
