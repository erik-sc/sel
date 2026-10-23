// @vitest-environment happy-dom
// Today's line for the week: the review's link only from Friday to Sunday, and the week's focus
// while there is one.
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import type { Block } from '@shared/types'
import { cleanup, fakeApi, render, seriousViolations } from '@/a11y/testing'
import { putBlocks } from '@/store/blocks'
import { TodayWeek } from './TodayWeek'

const block = (id: string, extra: Partial<Block>): Block =>
  ({ id, type: 'page', parentId: null, props: {}, content: [], createdAt: 0, updatedAt: 0, trashedAt: null, ...extra }) as Block

beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = fakeApi({ 'blocks.getMany': [] })
})

afterEach(cleanup)

describe('the week on Today', () => {
  it('says nothing midweek without a focus, and offers the review on Friday', async () => {
    const thursday = await render(<TodayWeek today="2026-10-22" />)
    expect(thursday.textContent).toBe('')
    await cleanup()
    const friday = await render(<TodayWeek today="2026-10-23" />)
    expect(friday.textContent).toContain('Weekly review')
    expect(await seriousViolations()).toEqual([])
  })

  it('shows the focus the review chose for this week, a done task struck through', async () => {
    await act(async () =>
      putBlocks([
        block(TASKS_DATABASE_ID, {
          type: 'database',
          props: { week: { '2026-10-19': { focus: ['t1', 't2'], note: '' } } }
        }),
        block('t1', { parentId: TASKS_DATABASE_ID, props: { title: [['Write the talk']], values: {} } }),
        block('t2', { parentId: TASKS_DATABASE_ID, props: { title: [['Call mum']], values: { [TASK_PROPS.done]: true } } })
      ])
    )
    const host = await render(<TodayWeek today="2026-10-21" />)
    expect([...host.querySelectorAll('.today-week-item')].map((item) => [item.textContent, item.classList.contains('is-done')])).toEqual([
      ['Write the talk', false],
      ['Call mum', true]
    ])
    expect(host.textContent).not.toContain('Weekly review')
  })
})
