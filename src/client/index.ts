// 浏览器半入口(方案 B):注册 AomeRAG 设置 section(参数表单)。
// 数据经 ui-settings 的 settingsScope wire(官方 assembly 已挂),无自建 remote(平台约束:
// api-remotes 能力集编译期固定,第三方无法注册新 RPC;状态/操作走 kb_* 工具对话)。
// namespace 字符串须与 src/tunable.ts 的 TUNABLE_NAMESPACE 保持一致('aomerag')。

import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { AomeragSection } from './AomeragSection.tsx'
import type { AomeragSectionInjected } from './AomeragSection.tsx'
import { en, zh, type AomeragKey } from './locales.ts'
import type { AomeragTunable, AomeragStatus, AomeragCommand } from '../tunable.ts'

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
  const tunable = ctx.settingsScope.bind<AomeragTunable>({ namespace: 'aomerag' })
  const status = ctx.settingsScope.bind<AomeragStatus>({ namespace: 'aomerag-status' })
  const command = ctx.settingsScope.bind<AomeragCommand>({ namespace: 'aomerag-command' })

  // 注册声明传 locale NS;第二参数是包装工厂(slot 系统渲染时调用,props 由闭包构造
  // 而非 outlet 注入——见 dshmarket 先例,直接传组件会拿到 runtime props 导致空渲染)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'aomerag',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: (): AomeragSectionInjected => ({ t, tunable, status, command }),
  }, () => createElement(AomeragSection, { t, tunable, status, command })))
}
