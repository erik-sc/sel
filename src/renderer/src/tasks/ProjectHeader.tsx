// The head of a project's list on the Tasks screen (0.8.0 E3): what the project is for (one
// sentence), its next action, how far along it is ("3 of 8 tasks done", never a percentage) and
// its milestones with dates. A project without a next action says so here; the weekly review and
// the day planning find the same projects through shared/tasks/projects.ts.
import { useState } from 'react'
import type { FormEvent, JSX } from 'react'
import { lateMilestones, OBJECTIVE_MAX, type ProjectSummary } from '@shared/tasks/projects'
import type { HomeLocale } from '@/home/copy'
import { useHome } from '@/home/store'
import { announce } from '@/a11y/announce'
import { toast } from '@/ui/toast'
import { addMilestone, removeMilestone, setNextAction, setObjective, updateMilestone, updateProjectPlan } from './projects'
import './project.css'

const PROJECT_COPY = {
  en: {
    region: (name: string) => `About ${name}`,
    objective: 'Objective',
    objectiveHint: 'One sentence: what is this project for?',
    next: 'Next action',
    noNext: 'No next action',
    chooseNext: 'Choose the next action',
    none: '—',
    use: (title: string) => `Use "${title}"`,
    open: (title: string) => `Open "${title}"`,
    progress: 'Progress',
    count: (done: number, total: number) => (total ? `${done} of ${total} tasks done` : 'No tasks yet'),
    milestones: 'Milestones',
    milestoneName: 'A milestone',
    milestoneDate: 'Date of the milestone',
    add: 'Add',
    reached: (title: string) => `Reached: ${title}`,
    remove: (title: string) => `Remove "${title}"`,
    removed: (title: string) => `Removed "${title}".`,
    undo: 'Undo',
    late: 'past its date',
    noDate: 'no date'
  },
  'pt-BR': {
    region: (name: string) => `Sobre ${name}`,
    objective: 'Objetivo',
    objectiveHint: 'Uma frase: para que serve este projeto?',
    next: 'Próxima ação',
    noNext: 'Sem próxima ação',
    chooseNext: 'Escolher a próxima ação',
    none: '—',
    use: (title: string) => `Usar "${title}"`,
    open: (title: string) => `Abrir "${title}"`,
    progress: 'Andamento',
    count: (done: number, total: number) => (total ? `${done} de ${total} tarefas concluídas` : 'Nenhuma tarefa ainda'),
    milestones: 'Marcos',
    milestoneName: 'Um marco',
    milestoneDate: 'Data do marco',
    add: 'Adicionar',
    reached: (title: string) => `Alcançado: ${title}`,
    remove: (title: string) => `Remover "${title}"`,
    removed: (title: string) => `"${title}" removido.`,
    undo: 'Desfazer',
    late: 'passou da data',
    noDate: 'sem data'
  }
} satisfies Record<HomeLocale, unknown>

function dateLabel(day: string, locale: HomeLocale): string {
  const [year, month, date] = day.split('-').map(Number)
  const value = new Date(year, month - 1, date)
  const sameYear = value.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(value)
}

export function ProjectHeader({
  summary,
  open,
  today,
  onOpenTask
}: {
  summary: ProjectSummary
  /** The project's open tasks, to choose the next action from. */
  open: readonly { id: string; title: string }[]
  today: string
  onOpenTask: (id: string) => void
}): JSX.Element {
  const locale = useHome((state) => state.locale)
  const words = PROJECT_COPY[locale]
  const [objective, setDraft] = useState(summary.objective)
  const [seen, setSeen] = useState(summary.objective)
  // Written elsewhere (another device, the other window): the field follows, unless it is being typed in.
  if (summary.objective !== seen) {
    setSeen(summary.objective)
    setDraft(summary.objective)
  }
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const late = new Set(lateMilestones(summary, today).map((milestone) => milestone.id))
  const id = summary.id

  const saveObjective = (): void => {
    if (objective.trim() !== summary.objective) setObjective(id, objective)
  }

  const add = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (addMilestone(id, name, /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null)) {
      setName('')
      setDate('')
    }
  }

  const remove = (milestoneId: string): void => {
    const milestone = summary.milestones.find((each) => each.id === milestoneId)
    if (!milestone) return
    removeMilestone(id, milestoneId)
    toast(words.removed(milestone.title), {
      action: {
        label: words.undo,
        run: () => updateProjectPlan(id, (plan) => ({ ...plan, milestones: [...plan.milestones, milestone] }))
      }
    })
  }

  return (
    <section className="project-head" aria-label={words.region(summary.name)}>
      <label className="project-line is-objective">
        <span className="project-label">{words.objective}</span>
        <input
          className="project-objective"
          value={objective}
          maxLength={OBJECTIVE_MAX}
          placeholder={words.objectiveHint}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={saveObjective}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              saveObjective()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              setDraft(summary.objective)
            }
          }}
        />
      </label>

      <div className="project-line">
        <span className="project-label" id={`project-next-${id}`}>
          {words.next}
        </span>
        <div className="project-value">
          {summary.next ? (
            <button
              type="button"
              className="project-next"
              aria-label={words.open(summary.next.title)}
              onClick={() => onOpenTask(summary.next?.id ?? '')}
            >
              {summary.next.title}
            </button>
          ) : (
            <span className="project-flag" data-flag="no-next">
              {words.noNext}
            </span>
          )}
          {!summary.next && summary.suggestion && (
            <button
              type="button"
              className="project-link"
              onClick={() => {
                if (!summary.suggestion) return
                setNextAction(id, summary.suggestion.id)
                announce(summary.suggestion.title)
              }}
            >
              {words.use(summary.suggestion.title)}
            </button>
          )}
          {open.length > 0 && (
            <select
              className="project-choose"
              aria-label={words.chooseNext}
              value={summary.next?.id ?? ''}
              onChange={(event) => setNextAction(id, event.target.value || null)}
            >
              <option value="">{words.none}</option>
              {open.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="project-line">
        <span className="project-label">{words.progress}</span>
        <span className="project-value project-count">{words.count(summary.done, summary.total)}</span>
      </div>

      <div className="project-line is-milestones">
        <span className="project-label" id={`project-milestones-${id}`}>
          {words.milestones}
        </span>
        <div className="project-value">
          {summary.milestones.length > 0 && (
            <ul className="project-milestones" aria-labelledby={`project-milestones-${id}`}>
              {summary.milestones.map((milestone) => {
                const classes = ['project-milestone']
                if (milestone.done) classes.push('is-done')
                if (late.has(milestone.id)) classes.push('is-late')
                return (
                  <li key={milestone.id} className={classes.join(' ')}>
                    <label className="project-milestone-name">
                      <input
                        type="checkbox"
                        checked={milestone.done}
                        onChange={(event) => {
                          updateMilestone(id, milestone.id, { done: event.target.checked })
                          if (event.target.checked) announce(words.reached(milestone.title))
                        }}
                      />
                      <span>{milestone.title}</span>
                    </label>
                    <input
                      type="date"
                      className="project-milestone-date"
                      aria-label={`${words.milestoneDate}: ${milestone.title}`}
                      value={milestone.date ?? ''}
                      title={
                        milestone.date
                          ? `${dateLabel(milestone.date, locale)}${late.has(milestone.id) ? `, ${words.late}` : ''}`
                          : words.noDate
                      }
                      onChange={(event) => updateMilestone(id, milestone.id, { date: event.target.value || null })}
                    />
                    {late.has(milestone.id) && <span className="project-late">{words.late}</span>}
                    <button
                      type="button"
                      className="project-remove"
                      aria-label={words.remove(milestone.title)}
                      onClick={() => remove(milestone.id)}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <form className="project-add" onSubmit={add}>
            <input
              aria-label={words.milestoneName}
              placeholder={words.milestoneName}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input type="date" aria-label={words.milestoneDate} value={date} onChange={(event) => setDate(event.target.value)} />
            <button type="submit" className="project-link" disabled={!name.trim()}>
              {words.add}
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}
