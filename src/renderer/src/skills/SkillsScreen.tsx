// The Skills screen: the user's skills and sel's own (shared/skills). A skill is a page, so
// writing one is opening it; here they are made, described, copied out and deleted.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, JSX } from 'react'
import { cleanSkillName, SKILL_LIMITS, slugSkillName } from '@shared/skills'
import type { SkillView } from '@shared/skills/api'
import { Section } from '@/finance/kit'
import type { HomeLocale } from '@/home/copy'
import { useHome } from '@/home/store'
import { openPage } from '@/store/tabs'
import { Button } from '@/ui/Button'
import { notifyError, toast } from '@/ui/toast'
import { SKILLS_COPY, type SkillsCopy } from './copy'
import '@/finance/finance.css'
import './skills.css'

function useSkills(): { skills: SkillView[] | null; failed: boolean; reload: () => void } {
  const [skills, setSkills] = useState<SkillView[] | null>(null)
  const [failed, setFailed] = useState(false)
  const latest = useRef(0)
  const reload = useCallback(() => {
    const turn = ++latest.current
    window.api.skills
      .list()
      .then((answer) => {
        if (turn !== latest.current) return
        setSkills(answer ?? [])
        setFailed(false)
      })
      .catch((error: unknown) => {
        if (turn !== latest.current) return
        console.error('[skills] the skills could not be read', error)
        setFailed(true)
      })
  }, [])
  useEffect(() => {
    reload()
    let timer: ReturnType<typeof setTimeout> | null = null
    // A skill saved by Claude over MCP, or renamed in its page, shows here by itself.
    const off = window.api.onChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(reload, 150)
    })
    return () => {
      if (timer) clearTimeout(timer)
      if (typeof off === 'function') off()
      latest.current++
    }
  }, [reload])
  return { skills, failed, reload }
}

function when(ms: number, locale: HomeLocale): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms))
}

function copyFile(name: string, copy: SkillsCopy): void {
  window.api.skills
    .file(name)
    .then((text) => navigator.clipboard.writeText(text))
    .then(
      () => toast(copy.copied),
      (error: unknown) => notifyError(copy.copyFailed, error)
    )
}

function NewSkill({ taken, copy, onDone }: { taken: ReadonlySet<string>; copy: SkillsCopy; onDone: () => void }): JSX.Element {
  const id = useId()
  const [typed, setTyped] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const name = slugSkillName(typed)
  const problem = !typed.trim() ? null : !cleanSkillName(name) ? copy.nameInvalid : taken.has(name) ? copy.nameTaken : null

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!cleanSkillName(name) || taken.has(name) || busy) return
    setBusy(true)
    window.api.skills
      .create(name, description)
      .then((pageId) => {
        setTyped('')
        setDescription('')
        onDone()
        // Writing a skill is writing its page.
        openPage(pageId)
      })
      .catch((error: unknown) => notifyError(copy.createFailed, error))
      .finally(() => setBusy(false))
  }

  return (
    <form className="fin-form skl-new" onSubmit={submit}>
      <div className="skl-new-fields">
        <label className="fin-field" htmlFor={`${id}-name`}>
          <span>{copy.name}</span>
          <input
            id={`${id}-name`}
            className="ui-input"
            value={typed}
            maxLength={SKILL_LIMITS.name}
            placeholder={copy.namePlaceholder}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-name-hint`}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <label className="fin-field" htmlFor={`${id}-description`}>
          <span>{copy.description}</span>
          <input
            id={`${id}-description`}
            className="ui-input"
            value={description}
            maxLength={SKILL_LIMITS.description}
            placeholder={copy.descriptionPlaceholder}
            aria-describedby={`${id}-description-hint`}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </div>
      <p className="fin-hint skl-hint" id={`${id}-name-hint`} role={problem ? 'alert' : undefined}>
        {problem ?? (name && name !== typed ? copy.nameHint(name) : '')}
      </p>
      <p className="fin-hint skl-hint" id={`${id}-description-hint`}>
        {copy.descriptionHint}
      </p>
      <Button type="submit" variant="primary" disabled={!cleanSkillName(name) || taken.has(name) || busy}>
        {copy.create}
      </Button>
    </form>
  )
}

function OwnSkill({
  skill,
  copy,
  locale,
  onDone
}: {
  skill: SkillView
  copy: SkillsCopy
  locale: HomeLocale
  onDone: () => void
}): JSX.Element {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(skill.description)

  const save = (event: FormEvent): void => {
    event.preventDefault()
    window.api.skills.describe(skill.name, draft).then(
      () => {
        setEditing(false)
        onDone()
      },
      (error: unknown) => notifyError(copy.saveFailed, error)
    )
  }
  const remove = (): void => {
    window.api.skills.remove(skill.name).then(
      () => {
        toast(copy.removed(skill.name))
        onDone()
      },
      (error: unknown) => notifyError(copy.removeFailed, error)
    )
  }

  return (
    <li className="skl-skill">
      <div className="skl-skill-head">
        <button type="button" className="skl-name" onClick={() => skill.id && openPage(skill.id)}>
          {skill.name}
        </button>
        {skill.updatedAt !== null && <span className="fin-row-note">{copy.changed(when(skill.updatedAt, locale))}</span>}
      </div>
      {editing ? (
        <form className="skl-describe" onSubmit={save}>
          <label className="fin-field" htmlFor={`${id}-description`}>
            <span>{copy.description}</span>
            <textarea
              id={`${id}-description`}
              className="ui-input skl-textarea"
              value={draft}
              rows={3}
              maxLength={SKILL_LIMITS.description}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <div className="skl-actions">
            <Button type="submit" variant="primary">
              {copy.save}
            </Button>
            <Button
              onClick={() => {
                setDraft(skill.description)
                setEditing(false)
              }}
            >
              {copy.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <p className={skill.description ? 'skl-description' : 'skl-description is-missing'}>{skill.description || copy.noDescription}</p>
      )}
      {!editing && (
        <div className="skl-actions">
          <button type="button" className="fin-link" onClick={() => skill.id && openPage(skill.id)}>
            {copy.open}
          </button>
          <button type="button" className="fin-link" onClick={() => setEditing(true)}>
            {copy.describe}
          </button>
          <button type="button" className="fin-link" onClick={() => copyFile(skill.name, copy)}>
            {copy.copyFile}
          </button>
          <button type="button" className="fin-link" onClick={remove}>
            {copy.remove}
          </button>
        </div>
      )}
    </li>
  )
}

/** One of sel's own: read here, since it has no page to open. */
function BuiltInSkill({ skill, copy }: { skill: SkillView; copy: SkillsCopy }): JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const load = (open: boolean): void => {
    if (!open || text !== null) return
    window.api.skills.file(skill.name).then(setText, (error: unknown) => notifyError(copy.failed, error))
  }
  return (
    <li className="skl-skill">
      <div className="skl-skill-head">
        <span className="skl-name is-plain">{skill.name}</span>
      </div>
      <p className="skl-description">{skill.description}</p>
      <details className="fin-setup skl-read" onToggle={(event) => load(event.currentTarget.open)}>
        <summary>{copy.read}</summary>
        <pre className="skl-file">{text ?? '…'}</pre>
        <button type="button" className="fin-link" onClick={() => copyFile(skill.name, copy)}>
          {copy.copyFile}
        </button>
      </details>
    </li>
  )
}

export function SkillsScreen(): JSX.Element {
  const locale = useHome((state) => state.locale)
  const copy = SKILLS_COPY[locale]
  const { skills, failed, reload } = useSkills()
  const own = (skills ?? []).filter((skill) => !skill.builtIn)
  const builtIn = (skills ?? []).filter((skill) => skill.builtIn)
  const taken = new Set((skills ?? []).map((skill) => skill.name))

  return (
    <article className="fin skl" lang={locale}>
      <header className="fin-head">
        <p className="fin-kicker">{copy.kicker}</p>
        <h1 className="fin-title">{copy.title}</h1>
        <p className="fin-lede">{copy.lede}</p>
      </header>
      {skills === null ? (
        <p className="fin-hint" role={failed ? 'alert' : 'status'}>
          {failed ? copy.failed : copy.loading}
        </p>
      ) : (
        <>
          <Section title={copy.yours}>
            {own.length ? (
              <ul className="skl-list">
                {own.map((skill) => (
                  <OwnSkill key={skill.id ?? skill.name} skill={skill} copy={copy} locale={locale} onDone={reload} />
                ))}
              </ul>
            ) : (
              <p className="fin-hint">{copy.none}</p>
            )}
          </Section>
          <Section title={copy.newSkill}>
            <NewSkill taken={taken} copy={copy} onDone={reload} />
          </Section>
          <Section title={copy.ofSel}>
            <p className="fin-hint skl-hint">{copy.ofSelHint}</p>
            <ul className="skl-list">
              {builtIn.map((skill) => (
                <BuiltInSkill key={skill.name} skill={skill} copy={copy} />
              ))}
            </ul>
          </Section>
          <Section title={copy.howTitle}>
            <ul className="skl-how">
              {copy.how.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </article>
  )
}
