// The template gallery: the templates as cards on the left, what the chosen one makes on the
// right, and how to make it (with examples or empty, and where) at the bottom. Loaded on demand
// through Host.tsx, with the templates' data.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { plainText } from '@shared/richtext'
import { listTemplates, type TemplateId, type TemplateLocale } from '@shared/templates'
import { homeLocale } from '@/home/copy'
import { useHome } from '@/home/store'
import { getBlock, putBlocks, refreshBlocks } from '@/store/blocks'
import { openPage } from '@/store/tabs'
import { refreshTree } from '@/store/tree'
import { setExpanded } from '@/store/ui'
import { logError, reportError } from '@/shell/actions'
import { Button } from '@/ui/Button'
import { IconGlyph } from '@/ui/IconGlyph'
import { TEMPLATES_COPY, type TemplatesCopy } from './copy'
import { closeTemplates, useTemplatesGate } from './gate'
import { templateOutline, type OutlineItem } from './outline'
import './templates.css'

/** Makes the template's page, shows it in the sidebar and opens it. */
async function make(id: TemplateId, locale: TemplateLocale, examples: boolean, parentId: string | null): Promise<void> {
  const page = await window.api.templates.create({ id, locale, examples, parentId })
  putBlocks([page])
  if (parentId) {
    setExpanded(parentId, true)
    await refreshBlocks([parentId]).catch(logError('refresh'))
  }
  await refreshTree().catch(logError('tree refresh'))
  openPage(page.id)
}

function Outline({ items, copy }: { items: OutlineItem[]; copy: TemplatesCopy }) {
  return (
    <ul className="tpl-outline">
      {items.map((item, index) => {
        if (item.kind === 'section') {
          return (
            <li key={index} className="tpl-outline-section">
              {item.title}
            </li>
          )
        }
        const detail =
          item.kind === 'database'
            ? [copy.properties(item.properties), item.views.map((v) => copy.views[v]).join(', '), item.rows ? copy.rows(item.rows) : null]
            : item.kind === 'linked'
              ? [copy.linkedView(item.source), item.views.map((v) => copy.views[v]).join(', ')]
              : [copy.page]
        return (
          <li key={index} className={`tpl-outline-item is-${item.kind}`}>
            <span className="tpl-outline-icon" aria-hidden="true">
              {item.kind !== 'linked' && item.icon ? <IconGlyph icon={item.icon} /> : <span className="tpl-outline-dot" />}
            </span>
            <span className="tpl-outline-title">{item.title}</span>
            <span className="tpl-outline-detail">{detail.filter(Boolean).join(' · ')}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function Gallery() {
  const { pageId, inside } = useTemplatesGate()
  const [locale, setLocale] = useState<TemplateLocale>(() => useHome.getState().locale)
  const copy = TEMPLATES_COPY[locale]
  const templates = useMemo(() => listTemplates(locale), [locale])
  const [chosen, setChosen] = useState<TemplateId>('finances')
  const [examples, setExamples] = useState(true)
  const [place, setPlace] = useState<'root' | 'inside'>(inside ? 'inside' : 'root')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const baseId = useId()

  // The language is read as the gallery opens: it may have changed in Settings since start-up.
  useEffect(() => {
    let alive = true
    window.api.app
      .getSetting<unknown>('ai.language')
      .then((language) => {
        if (alive) setLocale(homeLocale(language, navigator.language))
      })
      .catch(logError('read the language'))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
  }, [])

  const template = templates.find((t) => t.id === chosen) ?? templates[0]
  const outline = useMemo(() => templateOutline(template), [template])
  const parent = pageId ? getBlock(pageId) : undefined
  const canPlaceInside = !!parent && parent.type === 'page' && !parent.trashedAt

  const use = (): void => {
    if (busy) return
    setBusy(true)
    make(template.id, locale, examples, canPlaceInside && place === 'inside' ? (parent?.id ?? null) : null)
      .then(closeTemplates)
      .catch(reportError(copy.failed))
      .finally(() => setBusy(false))
  }

  const onListKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = templates.findIndex((t) => t.id === chosen)
    const columns = 2
    const step: Record<string, number> = { ArrowDown: columns, ArrowUp: -columns, ArrowRight: 1, ArrowLeft: -1 }
    if (event.key === 'Enter') {
      event.preventDefault()
      use()
      return
    }
    if (!(event.key in step)) return
    event.preventDefault()
    const next = templates[Math.min(templates.length - 1, Math.max(0, index + step[event.key]))]
    setChosen(next.id)
    listRef.current?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus()
  }

  return (
    <>
      <header className="tpl-head">
        <h2 id={`${baseId}-title`}>{copy.title}</h2>
        <p>{copy.intro}</p>
      </header>
      <div className="tpl-body">
        <div ref={listRef} className="tpl-cards" role="listbox" aria-label={copy.listLabel} onKeyDown={onListKey}>
          {templates.map((t) => (
            <button
              type="button"
              key={t.id}
              data-id={t.id}
              role="option"
              aria-selected={t.id === chosen}
              tabIndex={t.id === chosen ? 0 : -1}
              className={t.id === chosen ? 'tpl-card is-chosen' : 'tpl-card'}
              onClick={() => setChosen(t.id)}
              onDoubleClick={use}
            >
              <span className="tpl-card-icon" aria-hidden="true">
                <IconGlyph icon={`icon:${t.icon}`} />
              </span>
              <span className="tpl-card-name">{t.name}</span>
              <span className="tpl-card-description">{t.description}</span>
            </button>
          ))}
        </div>
        <section className="tpl-preview" aria-label={template.name}>
          <div className="tpl-preview-head">
            <span className="tpl-preview-icon" aria-hidden="true">
              <IconGlyph icon={`icon:${template.icon}`} />
            </span>
            <div>
              <h3>{template.name}</h3>
              <p>{template.description}</p>
            </div>
          </div>
          <Outline items={outline} copy={copy} />
        </section>
      </div>
      <footer className="tpl-foot">
        <div className="tpl-options">
          <div className="tpl-segmented" role="radiogroup" aria-label={copy.withExamples}>
            {[true, false].map((value) => (
              <button
                type="button"
                key={String(value)}
                role="radio"
                aria-checked={examples === value}
                className={examples === value ? 'is-on' : undefined}
                title={value ? copy.withExamplesHelp : copy.emptyHelp}
                onClick={() => setExamples(value)}
              >
                {value ? copy.withExamples : copy.empty}
              </button>
            ))}
          </div>
          {canPlaceInside && (
            <label className="tpl-place">
              <span>{copy.where}</span>
              <select value={place} onChange={(event) => setPlace(event.target.value as 'root' | 'inside')}>
                <option value="root">{copy.atRoot}</option>
                <option value="inside">{copy.inside(plainText(parent?.props.title) || copy.untitled)}</option>
              </select>
            </label>
          )}
          <span className="tpl-hint">{examples ? copy.withExamplesHelp : copy.emptyHelp}</span>
        </div>
        <div className="tpl-actions">
          <Button onClick={closeTemplates}>{copy.cancel}</Button>
          <Button variant="primary" disabled={busy} onClick={use}>
            {busy ? copy.making : copy.use}
          </Button>
        </div>
      </footer>
    </>
  )
}
