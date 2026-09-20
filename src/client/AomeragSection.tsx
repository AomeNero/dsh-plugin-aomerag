// AomeRAG 设置 section(浏览器半):11 参数表单 + 库状态快照 + 四操作按钮。
// props = inject face 扁平展开(t + 三个 settings scope);方法一律箭头包装绑定 this(#30)。
// 样式 inline(section 外壳由设置 shell 提供)。

import { useSyncExternalStore, useState, type ChangeEvent } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { AomeragKey } from './locales.ts'
import type { AomeragTunable, AomeragStatus, AomeragCommand, AomeragAction } from '../tunable.ts'

export interface AomeragSectionInjected {
  t: (key: AomeragKey) => string
  tunable: SettingsScope<AomeragTunable>
  status: SettingsScope<AomeragStatus>
  command: SettingsScope<AomeragCommand>
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type AomeragSectionProps = Partial<AomeragSectionInjected>

type NumberKey = 'chunkTarget' | 'chunkMax' | 'chunkOverlap' | 'topK' | 'rrfK' | 'embedBatchSize'
type TextKey = 'ollamaBaseUrl' | 'embedModel' | 'mdDir' | 'dbPath'

interface FieldBase {
  labelKey: `field.${string}`
  hintKey: AomeragKey
  restart?: boolean
  min?: number
}

type FieldDef =
  | (FieldBase & { key: NumberKey; kind: 'number'; min: number })
  | (FieldBase & { key: TextKey; kind: 'text' })

const FIELDS: readonly FieldDef[] = [
  { key: 'chunkTarget', kind: 'number', labelKey: 'field.chunkTarget', hintKey: 'hint.chunk', min: 100 },
  { key: 'chunkMax', kind: 'number', labelKey: 'field.chunkMax', hintKey: 'hint.chunk', min: 200 },
  { key: 'chunkOverlap', kind: 'number', labelKey: 'field.chunkOverlap', hintKey: 'hint.chunk', min: 0 },
  { key: 'topK', kind: 'number', labelKey: 'field.topK', hintKey: 'hint.search', min: 1 },
  { key: 'rrfK', kind: 'number', labelKey: 'field.rrfK', hintKey: 'hint.search', min: 1 },
  { key: 'embedBatchSize', kind: 'number', labelKey: 'field.embedBatchSize', hintKey: 'hint.batch', min: 1 },
  { key: 'ollamaBaseUrl', kind: 'text', labelKey: 'field.ollamaBaseUrl', hintKey: 'hint.ollama' },
  { key: 'embedModel', kind: 'text', labelKey: 'field.embedModel', hintKey: 'hint.model' },
  { key: 'mdDir', kind: 'text', labelKey: 'field.mdDir', hintKey: 'hint.mdDir', restart: true },
  { key: 'dbPath', kind: 'text', labelKey: 'field.dbPath', hintKey: 'hint.dbPath', restart: true },
]

const styles = {
  section: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '560px' } as const,
  intro: { fontSize: '13px', opacity: 0.8, margin: 0 } as const,
  row: { display: 'flex', flexDirection: 'column', gap: '3px' } as const,
  checkRow: { display: 'flex', alignItems: 'center', gap: '8px' } as const,
  label: { fontSize: '13px', fontWeight: 600 } as const,
  hint: { fontSize: '12px', opacity: 0.65, margin: 0 } as const,
  restartBadge: { fontSize: '11px', color: '#b45309', fontWeight: 600, marginLeft: '6px' } as const,
  input: { width: '320px', padding: '5px 8px', fontSize: '13px' } as const,
  numberInput: { width: '180px', padding: '5px 8px', fontSize: '13px' } as const,
  divider: { border: 0, borderTop: '1px solid rgba(128,128,128,0.25)', margin: '10px 0' } as const,
  kvGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', fontSize: '13px' } as const,
  kvKey: { opacity: 0.7 } as const,
  badge: { fontSize: '12px', padding: '1px 8px', borderRadius: '10px', background: 'rgba(128,128,128,0.2)' } as const,
  badgeBusy: { fontSize: '12px', padding: '1px 8px', borderRadius: '10px', background: 'rgba(59,130,246,0.25)' } as const,
  report: { fontSize: '13px', margin: 0 } as const,
  errors: { fontSize: '12px', opacity: 0.8, margin: '4px 0 0', whiteSpace: 'pre-wrap' } as const,
  btnRow: { display: 'flex', gap: '8px', flexWrap: 'wrap' } as const,
  btn: { padding: '6px 14px', fontSize: '13px', cursor: 'pointer' } as const,
  btnDanger: { padding: '6px 14px', fontSize: '13px', cursor: 'pointer', color: '#b91c1c', borderColor: '#b91c1c' } as const,
  note: { fontSize: '12px', opacity: 0.65, margin: 0 } as const,
} as const

export function AomeragSection({ t, tunable, status, command }: AomeragSectionProps) {
  if (t === undefined || tunable === undefined || status === undefined || command === undefined) return null

  const form = useSyncExternalStore(
    (onChange) => tunable.subscribe(onChange),
    () => tunable.getSnapshot(),
  )
  const snap = useSyncExternalStore(
    (onChange) => status.subscribe(onChange),
    () => status.getSnapshot(),
  )
  const cmd = useSyncExternalStore(
    (onChange) => command.subscribe(onChange),
    () => command.getSnapshot(),
  )

  const writable = form.status === 'ready' && form.writable
  const values = form.value
  const st = snap.value
  const busy = cmd.value?.action !== undefined && cmd.value.action !== 'none'
  const [armed, setArmed] = useState<'rebuild' | 'clear' | null>(null)

  const onNumber = (key: NumberKey, min: number) =>
    (e: ChangeEvent<HTMLInputElement>): void => {
      const n = Number(e.target.value)
      if (Number.isFinite(n) && n >= min) void tunable.set(key, n)
    }
  const onText = (key: TextKey) =>
    (e: ChangeEvent<HTMLInputElement>): void => {
      if (e.target.value !== '') void tunable.set(key, e.target.value)
    }
  const sendCommand = (action: AomeragAction): void => {
    void command.set('action', action)
    void command.set('nonce', Date.now())
    setArmed(null)
  }

  return (
    <div style={styles.section}>
      <p style={styles.intro}>{t('intro')}</p>
      {form.status !== 'ready' && <p style={styles.note}>{t('readonly')}</p>}

      {FIELDS.map((f) => (
        <label key={f.key} style={styles.row}>
          <span style={styles.label}>
            {t(f.labelKey as AomeragKey)}
            {f.restart === true && <span style={styles.restartBadge}>⟳ {t('restartNeeded')}</span>}
          </span>
          <input
            style={f.kind === 'number' ? styles.numberInput : styles.input}
            type={f.kind}
            min={f.min}
            disabled={!writable}
            value={values?.[f.key] ?? ''}
            onChange={f.kind === 'number' ? onNumber(f.key, f.min) : onText(f.key)}
          />
          <p style={styles.hint}>{t(f.hintKey)}</p>
        </label>
      ))}

      <label style={styles.checkRow}>
        <input
          type="checkbox"
          disabled={!writable}
          checked={values?.syncOnStart ?? true}
          onChange={(e) => void tunable.set('syncOnStart', e.target.checked)}
        />
        <span style={styles.label}>{t('field.syncOnStart')}</span>
      </label>
      <p style={styles.hint}>{t('hint.syncOnStart')}</p>

      <hr style={styles.divider} />
      <span style={styles.label}>{t('status.title')}</span>
      {st === undefined ? (
        <p style={styles.note}>{t('loading')}</p>
      ) : (
        <>
          <div style={styles.kvGrid}>
            <span style={styles.kvKey}>{t('status.docs')}</span><span>{st.docs}</span>
            <span style={styles.kvKey}>{t('status.chunks')}</span><span>{st.chunks}</span>
            <span style={styles.kvKey}>{t('status.lastSyncAt')}</span>
            <span>{st.syncing ? t('status.syncing') : (st.lastSyncAt === '' ? t('status.never') : st.lastSyncAt)}</span>
            <span style={styles.kvKey}>{t('status.dbSize')}</span><span>{st.dbSizeMB} MB</span>
            <span style={styles.kvKey}>{t('status.dbPath')}</span><span style={{ fontSize: '12px' }}>{st.dbPath}</span>
            <span style={styles.kvKey}>{t('status.model')}</span>
            <span>
              {st.model}{' '}
              <span style={st.syncing ? styles.badgeBusy : styles.badge}>
                {st.syncing ? t('status.syncing') : t('status.idle')}
              </span>
            </span>
          </div>
          {(st.lastReport.added > 0 || st.lastReport.updated > 0 || st.lastReport.skipped > 0
            || st.lastReport.removed > 0 || st.lastReport.failed > 0) && (
            <>
              <p style={styles.report}>
                {t('report.title')}:{t('report.added')} {st.lastReport.added} · {t('report.updated')}{' '}
                {st.lastReport.updated} · {t('report.skipped')} {st.lastReport.skipped} ·{' '}
                {t('report.removed')} {st.lastReport.removed} · {t('report.failed')} {st.lastReport.failed}
              </p>
              {st.lastReport.failed > 0 && st.lastReport.errors.length > 0 && (
                <p style={styles.errors}>{t('report.errors')}:{'\n'}{st.lastReport.errors.join('\n')}</p>
              )}
            </>
          )}
        </>
      )}

      <hr style={styles.divider} />
      <span style={styles.label}>{t('btn.title')}</span>
      <div style={styles.btnRow}>
        <button style={styles.btn} disabled={!writable || busy} onClick={() => sendCommand('sync')}>
          {busy ? t('btn.busy') : t('btn.sync')}
        </button>
        <button
          style={armed === 'rebuild' ? styles.btnDanger : styles.btn}
          disabled={!writable || busy}
          title={t('btn.confirmRebuild')}
          onClick={() => (armed === 'rebuild' ? sendCommand('rebuild') : setArmed('rebuild'))}
          onBlur={() => setArmed(null)}
        >
          {armed === 'rebuild' ? t('btn.confirmRebuild') : t('btn.rebuild')}
        </button>
        <button
          style={armed === 'clear' ? styles.btnDanger : styles.btn}
          disabled={!writable || busy}
          title={t('btn.confirmClear')}
          onClick={() => (armed === 'clear' ? sendCommand('clear') : setArmed('clear'))}
          onBlur={() => setArmed(null)}
        >
          {armed === 'clear' ? t('btn.confirmClear') : t('btn.clear')}
        </button>
        <button style={styles.btn} disabled={!writable} onClick={() => sendCommand('openDir')}>
          {t('btn.openDir')}
        </button>
      </div>
    </div>
  )
}
