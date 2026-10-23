// The editor of a project's or database's own context for the AI (0.8.0 A4): a short text and up
// to three pinned pages, sent only with requests made from inside it (shared/aiScope.ts says what
// belongs where). Opened from the head of a project on Tasks and from a database's ⋯ menu; fetched
// the first time it is (see ScopeContextHost.tsx).
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { SCOPE_CONTEXT_CAPS } from '@shared/aiScope'
import type { Block } from '@shared/types'
import { useHerman } from '@/herman/gate'
import { useHome } from '@/home/store'
import { pageTitle } from '@/shell/actions'
import { useBlock } from '@/store/blocks'
import { Button, IconButton } from '@/ui/Button'
import { Close } from '@/ui/icons'
import { Modal } from '@/ui/Modal'
import { notifyError, toast } from '@/ui/toast'
import { contextCopy, type ContextCopy } from './contextCopy'
import { LockMark } from './PrivateLock'
import { useAiPrivacy } from './privacy'
import {
  canPinToScope,
  closeScopeContext,
  saveScopeContext,
  scopeContextOf,
  scopeName,
  scopePrivateNow,
  useScopeEditor,
  type ScopeTarget
} from './scopeContext'
import './scope.css'

const RESULTS = 8
const SEARCH_DEBOUNCE_MS = 180

export function ScopeContextDialog(): JSX.Element | null {
  const target = useScopeEditor((state) => state.target)
  if (!target) return null
  return <Editor key={`${target.kind}:${target.id}`} target={target} />
}

function Editor({ target }: { target: ScopeTarget }): JSX.Element {
  const locale = useHome((state) => state.locale)
  const persona = useHerman((state) => state.persona)
  const copy = useMemo(() => contextCopy(locale, persona), [locale, persona])
  // Follows the block (a rename shows), while the fields keep what was stored when the editor opened.
  useBlock(target.kind === 'project' ? null : target.id)
  const [initial] = useState(() => scopeContextOf(target))
  const [text, setText] = useState(initial?.text ?? '')
  const [pages, setPages] = useState<string[]>(initial?.pages ?? [])
  const [saving, setSaving] = useState(false)
  const titleId = useId()
  const textId = useId()
  const name = scopeName(target)
  const isPrivate = scopePrivateNow(target)
  const changed = text !== (initial?.text ?? '') || pages.join('\n') !== (initial?.pages ?? []).join('\n')

  const pin = (block: Block): void => {
    void canPinToScope(block.id, pages).then((result) => {
      if (result === 'private') toast(copy.pinPrivate, { kind: 'info', duration: 6000 })
      else if (result === 'full') toast(copy.scopeFull(SCOPE_CONTEXT_CAPS.pages), { kind: 'info', duration: 4000 })
      else setPages((current) => (current.includes(block.id) ? current : [...current, block.id]))
    })
  }

  const save = (): void => {
    setSaving(true)
    saveScopeContext(target, { text: text.slice(0, SCOPE_CONTEXT_CAPS.text), pages }).then(
      () => {
        toast(copy.scopeSaved, { kind: 'success', duration: 2000 })
        closeScopeContext()
      },
      (error: unknown) => {
        setSaving(false)
        notifyError(copy.scopeSaveFailed, error)
      }
    )
  }

  return (
    <Modal open onClose={closeScopeContext} labelledBy={titleId} className="ai-scope">
      <header className="ai-scope-head">
        <h2 id={titleId}>{copy.scopeTitle(target.kind, name)}</h2>
        <IconButton label={copy.cancel} tooltip={false} onClick={closeScopeContext}>
          <Close />
        </IconButton>
      </header>
      <div className="ai-scope-body">
        <p className="ai-scope-lead">{copy.scopeIntro(target.kind)}</p>
        {isPrivate && (
          <p className="ai-scope-private" role="note">
            <LockMark why={copy.scopePrivate(target.kind)} /> {copy.scopePrivate(target.kind)}
          </p>
        )}
        <label className="ai-scope-label" htmlFor={textId}>
          {copy.scopeTextLabel}
        </label>
        <textarea
          id={textId}
          className="ai-scope-field ai-scope-text"
          value={text}
          rows={6}
          maxLength={SCOPE_CONTEXT_CAPS.text}
          placeholder={copy.scopePlaceholder(target.kind)}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !saving) {
              event.preventDefault()
              save()
            }
          }}
        />
        <span className="ai-scope-count">{copy.contextCount(text.length, SCOPE_CONTEXT_CAPS.text)}</span>

        <h3 className="ai-scope-label">{copy.scopePagesLabel(SCOPE_CONTEXT_CAPS.pages)}</h3>
        {pages.length === 0 ? (
          <p className="ai-scope-help">{copy.scopePagesNone}</p>
        ) : (
          <ul className="ai-scope-pages">
            {pages.map((id) => (
              <PinnedPage key={id} id={id} copy={copy} onUnpin={() => setPages((current) => current.filter((entry) => entry !== id))} />
            ))}
          </ul>
        )}
        {pages.length < SCOPE_CONTEXT_CAPS.pages && <PageSearch copy={copy} exclude={pages} onPick={pin} />}
        <p className="ai-scope-help">{copy.scopeKept(target.kind)}</p>
      </div>
      <footer className="ai-scope-foot">
        <Button onClick={closeScopeContext}>{copy.cancel}</Button>
        <Button variant="primary" disabled={saving || !changed} onClick={save}>
          {copy.save}
        </Button>
      </footer>
    </Modal>
  )
}

function PinnedPage({ id, copy, onUnpin }: { id: string; copy: ContextCopy; onUnpin: () => void }): JSX.Element {
  const block = useBlock(id)
  // Pinned before it was made private: kept in the list, never sent.
  const privacy = useAiPrivacy(id, true)
  const gone = Boolean(block?.trashedAt)
  const title = block ? pageTitle(block) : '…'
  return (
    <li className="ai-scope-page">
      <span className={gone ? 'ai-scope-help is-error' : 'ai-scope-page-title'}>{gone ? copy.missingPage : title}</span>
      {!gone && privacy && <LockMark why={copy.privateWhy[privacy.reason]} label={copy.pinnedPrivate} />}
      <Button variant="ghost" aria-label={copy.scopeUnpinPage(title)} onClick={onUnpin}>
        {copy.unpin}
      </Button>
    </li>
  )
}

/** A search over the pages (the recent ones when it is empty); picking one pins it. */
function PageSearch({
  copy,
  exclude,
  onPick
}: {
  copy: ContextCopy
  exclude: readonly string[]
  onPick: (block: Block) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Block[] | null>(null)
  const request = useRef(0)

  useEffect(() => {
    const current = ++request.current
    const timer = setTimeout(
      () => {
        const text = query.trim()
        const read: Promise<Block[]> = text
          ? window.api.search
              .query(text, RESULTS * 2)
              .then((hits) => window.api.blocks.getMany([...new Set(hits.map((hit) => hit.pageId))].slice(0, RESULTS * 2)))
          : window.api.pages.listRecent(RESULTS * 2)
        read.then(
          (blocks) => {
            if (current === request.current)
              setFound(blocks.filter((block) => (block.type === 'page' || block.type === 'database') && !block.trashedAt))
          },
          (error: unknown) => console.error('ai: finding pages to pin failed', error)
        )
      },
      query ? SEARCH_DEBOUNCE_MS : 0
    )
    return () => clearTimeout(timer)
  }, [query])

  const shown = (found ?? []).filter((block) => !exclude.includes(block.id)).slice(0, RESULTS)
  return (
    <div className="ai-scope-search">
      <input
        type="search"
        className="ai-scope-field"
        value={query}
        placeholder={copy.scopeSearch}
        aria-label={copy.scopeSearch}
        onChange={(event) => setQuery(event.target.value)}
      />
      {found !== null &&
        (shown.length === 0 ? (
          <p className="ai-scope-help">{copy.scopeSearchNone}</p>
        ) : (
          <ul className="ai-scope-results">
            {shown.map((block) => (
              <li key={block.id}>
                <button
                  type="button"
                  className="ai-scope-result"
                  aria-label={copy.scopePinPage(pageTitle(block))}
                  onClick={() => onPick(block)}
                >
                  {pageTitle(block)}
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}
