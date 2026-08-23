// AomeRAG 设置 section(浏览器半):6 个可调参数表单 + 状态/同步引导。
// props 协议 = inject face 扁平展开(dsh slot outlet 惯例,见 ui-settings-models 的 ModelsSection);
// t 与 host 都由 apply 侧注入。样式 inline(section 外壳由设置 shell 提供),不引 CSS Modules 以简化构建。

import { useSyncExternalStore, type ChangeEvent } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { AomeragKey } from './locales.ts'
import type { AomeragTunable } from '../tunable.ts'

export interface AomeragSectionInjected {
  t: (key: AomeragKey) => string
  host: SettingsScope<AomeragTunable>
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type AomeragSectionProps = Partial<AomeragSectionInjected>

interface FieldDef {
  key: keyof AomeragTunable
  labelKey: 'field.chunkTarget' | 'field.chunkMax' | 'field.chunkOverlap' | 'field.topK' | 'field.rrfK' | 'field.embedBatchSize'
  hintKey: 'hint.chunk' | 'hint.search' | 'hint.batch'
  min: number
}

const FIELDS: readonly FieldDef[] = [
  { key: 'chunkTarget', labelKey: 'field.chunkTarget', hintKey: 'hint.chunk', min: 100 },
  { key: 'chunkMax', labelKey: 'field.chunkMax', hintKey: 'hint.chunk', min: 200 },
  { key: 'chunkOverlap', labelKey: 'field.chunkOverlap', hintKey: 'hint.chunk', min: 0 },
  { key: 'topK', labelKey: 'field.topK', hintKey: 'hint.search', min: 1 },
  { key: 'rrfK', labelKey: 'field.rrfK', hintKey: 'hint.search', min: 1 },
  { key: 'embedBatchSize', labelKey: 'field.embedBatchSize', hintKey: 'hint.batch', min: 1 },
]

const styles = {
  section: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '560px' } as const,
  intro: { fontSize: '13px', opacity: 0.8, margin: 0 } as const,
  row: { display: 'flex', flexDirection: 'column', gap: '3px' } as const,
  label: { fontSize: '13px', fontWeight: 600 } as const,
  hint: { fontSize: '12px', opacity: 0.65, margin: 0 } as const,
  input: { width: '180px', padding: '5px 8px', fontSize: '13px' } as const,
  divider: { border: 0, borderTop: '1px solid rgba(128,128,128,0.25)', margin: '10px 0' } as const,
  opsItem: { fontSize: '13px', margin: 0 } as const,
  note: { fontSize: '12px', opacity: 0.65, margin: 0 } as const,
} as const

export function AomeragSection({ t, host }: AomeragSectionProps) {
  if (t === undefined || host === undefined) return null
  const snap = useSyncExternalStore(host.subscribe, host.getSnapshot)
  const writable = snap.status === 'ready' && snap.writable
  const value = snap.value

  const onField = (key: keyof AomeragTunable, min: number) =>
    (e: ChangeEvent<HTMLInputElement>): void => {
      const n = Number(e.target.value)
      if (Number.isFinite(n) && n >= min) void host.set(key, n)
    }

  return (
    <div style={styles.section}>
      <p style={styles.intro}>{t('intro')}</p>

      {snap.status !== 'ready' && <p style={styles.note}>{t('readonly')}</p>}

      {FIELDS.map((f) => (
        <label key={f.key} style={styles.row}>
          <span style={styles.label}>{t(f.labelKey)}</span>
          <input
            style={styles.input}
            type="number"
            min={f.min}
            disabled={!writable}
            value={value?.[f.key] ?? ''}
            onChange={onField(f.key, f.min)}
          />
          <p style={styles.hint}>{t(f.hintKey)}</p>
        </label>
      ))}

      <hr style={styles.divider} />
      <span style={styles.label}>{t('ops.title')}</span>
      <p style={styles.opsItem}>• {t('ops.status')}</p>
      <p style={styles.opsItem}>• {t('ops.sync')}</p>

      <hr style={styles.divider} />
      <p style={styles.note}>{t('deployNote')}</p>
    </div>
  )
}
