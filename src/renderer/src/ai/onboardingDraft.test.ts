import { describe, expect, it } from 'vitest'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import type { Block } from '@shared/types'
import { composeContext, EMPTY_ANSWERS, mergeContext, projectList, rankPages, suggestedProjects } from './onboardingDraft'

describe('the context the introduction drafts', () => {
  it('is empty with nothing answered', () => {
    expect(composeContext(EMPTY_ANSWERS, 'en')).toBe('')
  })

  it('has one line per question answered, in the language of the screen', () => {
    const answers = {
      who: '  Ana,   product designer ',
      work: 'A fintech in São Paulo, the mobile app!',
      projects: ['Auxiliadora', 'Sel'],
      otherProjects: 'sel, Garden ; Blog',
      length: 'short' as const,
      language: 'pt-BR' as const,
      tone: 'direct' as const
    }
    expect(composeContext(answers, 'en')).toBe(
      [
        'About me: Ana, product designer.',
        'My work: A fintech in São Paulo, the mobile app!',
        'My projects: Auxiliadora, Sel, Garden, Blog.',
        'How I like answers: short and to the point, in Portuguese (Brazil), in a direct tone.'
      ].join('\n')
    )
    expect(composeContext({ ...EMPTY_ANSWERS, length: 'detailed', language: 'same' }, 'pt-BR')).toBe(
      'Como gosto das respostas: detalhadas, com o raciocínio, no idioma em que eu escrever.'
    )
    expect(projectList({ projects: [], otherProjects: ' , ,' })).toEqual([])
  })

  it('goes after what is already written, never over it', () => {
    expect(mergeContext('', 'About me: Ana.')).toEqual({ text: 'About me: Ana.', fits: true, changed: true })
    expect(mergeContext('I like tea.\n\n', 'About me: Ana.')).toEqual({ text: 'I like tea.\n\nAbout me: Ana.', fits: true, changed: true })
    // Already there, or nothing to add: unchanged.
    expect(mergeContext('I like tea.\n\nAbout me: Ana.', 'About me: Ana.')).toMatchObject({ changed: false })
    expect(mergeContext('I like tea.', '   ')).toEqual({ text: 'I like tea.', fits: true, changed: false })
    // Past the cap together: it does not fit, and nothing is cut.
    const long = mergeContext('x'.repeat(95), 'y'.repeat(10), 100)
    expect(long).toEqual({ text: `${'x'.repeat(95)}\n\n${'y'.repeat(10)}`, fits: false, changed: true })
  })
})

describe('what the introduction suggests', () => {
  it('offers the projects of Tasks, not the private ones', () => {
    const tasks = {
      id: TASKS_DATABASE_ID,
      props: {
        schema: {
          [TASK_PROPS.project]: {
            id: TASK_PROPS.project,
            name: 'Project',
            type: 'select',
            options: [
              { id: 'p1', name: 'Auxiliadora', color: 'blue' },
              { id: 'p2', name: 'Diary', color: 'red' },
              { id: 'p3', name: ' ', color: 'red' }
            ]
          }
        },
        aiPrivateProjects: ['p2']
      }
    } as unknown as Block
    expect(suggestedProjects(tasks)).toEqual(['Auxiliadora'])
    expect(suggestedProjects(undefined)).toEqual([])
  })

  it('offers the pages you come back to, then the ones edited last, never a private one', () => {
    const returning = [
      { pageId: 'a', days: 2, opens: 9 },
      { pageId: 'b', days: 5, opens: 3 },
      { pageId: 'secret', days: 9, opens: 9 }
    ]
    expect(rankPages(returning, ['c', 'a', 'd'], (id) => id === 'secret', 4)).toEqual(['b', 'a', 'c', 'd'])
    expect(rankPages([], [], () => false)).toEqual([])
  })
})
