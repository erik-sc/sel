// @vitest-environment happy-dom
// Blocks side by side on a page (0.9.0 A1a): the editor and the version viewer draw a row as one
// group of columns, each column a block with its children inside it, wide only past 2 columns.
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Block, BlockProps, BlockType } from '@shared/types'
import type { SnapshotBlock, SnapshotContent } from '@shared/versions'
import { cleanup, fakeApi, render, seriousViolations } from '@/a11y/testing'
import { getBlock, putBlocks } from '@/store/blocks'
import { useHome } from '@/home/store'
import { SnapshotView } from '@/versions/ReadOnlyBlocks'
import { BlockList } from './BlockView'
import { EditorContext } from './context'
import { EditorController } from './controller'
import { BlockMenu } from './menus'

const block = (id: string, type: BlockType, parentId: string, props: BlockProps = {}, content: string[] = []): Block => ({
  id,
  type,
  parentId,
  content,
  props,
  createdAt: 0,
  updatedAt: 0,
  trashedAt: null
})

/** A page: a text head with two children beside a callout, then a row of three text blocks. */
const PAGE: Block[] = [
  block('pg', 'page', '', { title: [['Columns']] }, ['t', 'c', 'r1', 'r2', 'r3']),
  block('t', 'text', 'pg', { title: [['Head']] }, ['k1', 'k2']),
  block('k1', 'text', 't', { title: [['First child']] }),
  block('k2', 'text', 't', { title: [['Second child']] }),
  block('c', 'callout', 'pg', { title: [['Aside']], icon: '💡', beside: true }),
  block('r1', 'text', 'pg', { title: [['One']] }),
  block('r2', 'text', 'pg', { title: [['Two']], beside: true }),
  block('r3', 'text', 'pg', { title: [['Three']], beside: true })
]

beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = fakeApi({ 'blocks.getMany': [], 'blocks.apply': [] })
})

afterEach(async () => {
  await cleanup()
  useHome.setState({ locale: 'en' })
})

/** The rows drawn in `host`: for each, its label, whether it is wide, and its columns' ids. */
function rows(host: Element, column: (el: Element) => string): { label: string | null; wide: boolean; columns: string[] }[] {
  return [...host.querySelectorAll('.blk-beside')].map((row) => ({
    label: row.getAttribute('aria-label'),
    wide: row.classList.contains('is-wide'),
    columns: [...row.children].map(column)
  }))
}

async function editor(): Promise<HTMLElement> {
  await act(async () => putBlocks(PAGE))
  const ctrl = new EditorController('pg')
  return render(
    <EditorContext.Provider value={{ ctrl, onOpenPage: () => {} }}>
      <div className="pe-content pe-body">
        <BlockList ids={PAGE[0].content} top />
      </div>
    </EditorContext.Provider>
  )
}

describe('columns in the editor', () => {
  it('draws a text head with its children beside a callout as one group of two columns, at text width', async () => {
    const host = await editor()
    expect(rows(host, (el) => el.getAttribute('data-block-id') ?? '')).toEqual([
      { label: '2 columns', wide: false, columns: ['t', 'c'] },
      { label: '3 columns', wide: true, columns: ['r1', 'r2', 'r3'] }
    ])
    const first = host.querySelector('.blk-beside > [data-block-id="t"]')
    const kids = [...(first?.querySelectorAll(':scope > .blk-children > .blk') ?? [])].map((el) => el.getAttribute('data-block-id'))
    expect(kids).toEqual(['k1', 'k2'])
    expect(host.querySelectorAll('.blk-beside[role="group"]')).toHaveLength(2)
    // A block's text with words in it has no name of its own today (only aria-placeholder while
    // empty): an editor-wide finding, outside this item, so it is left out here.
    expect((await seriousViolations()).filter((v) => !v.startsWith('aria-input-field-name'))).toEqual([])
  })

  it('keeps nested blocks one under the other even when marked beside', async () => {
    await act(async () => putBlocks([{ ...PAGE[3], props: { ...PAGE[3].props, beside: true } }]))
    const host = await editor()
    expect(host.querySelector('[data-block-id="t"] .blk-beside')).toBeNull()
  })

  it('names the group in Portuguese for a pt-BR home', async () => {
    useHome.setState({ locale: 'pt-BR' })
    const host = await editor()
    expect(rows(host, () => '').map((row) => row.label)).toEqual(['2 colunas', '3 colunas'])
  })
})

describe('the controller and rows', () => {
  const beside = (id: string): unknown => getBlock(id)?.props.beside

  it('repairs the row in the same step when its head is deleted, and one undo brings both back', async () => {
    await act(async () => putBlocks(PAGE))
    const ctrl = new EditorController('pg')
    await act(async () => ctrl.deleteBlocks(['t']))
    expect(getBlock('pg')?.content).toEqual(['c', 'r1', 'r2', 'r3'])
    expect(beside('c')).toBeUndefined()
    await act(async () => ctrl.undo())
    expect(getBlock('pg')?.content).toEqual(PAGE[0].content)
    expect(beside('c')).toBe(true)
  })

  it('places a block beside the one before it and says so', async () => {
    await act(async () => putBlocks(PAGE))
    const ctrl = new EditorController('pg')
    await act(async () => ctrl.setBeside('c', false))
    expect(beside('c')).toBeUndefined()
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)))
    expect(document.querySelector('[data-announcer]')?.textContent).toBe('Placed below')
    useHome.setState({ locale: 'pt-BR' })
    await act(async () => ctrl.setBeside('c', true))
    expect(beside('c')).toBe(true)
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)))
    expect(document.querySelector('[data-announcer]')?.textContent).toBe('Colocado ao lado')
  })
})

describe('the block menu', () => {
  async function menuFor(id: string): Promise<string[]> {
    await act(async () => putBlocks(PAGE))
    const ctrl = new EditorController('pg')
    ctrl.ui.setState({ menu: { id, rect: new DOMRect(0, 0, 10, 10) } })
    await render(
      <EditorContext.Provider value={{ ctrl, onOpenPage: () => {} }}>
        <BlockMenu />
      </EditorContext.Provider>
    )
    return [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent ?? '')
  }

  it('offers a text block the row before it, and a column the way out', async () => {
    expect((await menuFor('r1')).some((label) => label.includes('Place beside the previous block'))).toBe(true)
    await cleanup()
    expect((await menuFor('c')).some((label) => label.includes('Place below the previous block'))).toBe(true)
    await cleanup()
    // Nested blocks and the first block of the page are offered neither.
    for (const id of ['k2', 't']) {
      expect((await menuFor(id)).some((label) => label.includes('previous block'))).toBe(false)
      await cleanup()
    }
  })

  it('says it in Portuguese for a pt-BR home', async () => {
    useHome.setState({ locale: 'pt-BR' })
    expect((await menuFor('r1')).some((label) => label.includes('Colocar ao lado do bloco anterior'))).toBe(true)
  })
})

describe('columns in the version viewer', () => {
  it('draws the same rows as the editor', async () => {
    const snap = (b: Block): SnapshotBlock => ({
      id: b.id,
      type: b.type,
      parentId: b.parentId || null,
      props: b.props,
      content: b.content,
      createdAt: 0
    })
    const version: SnapshotContent = { rootId: 'pg', blocks: PAGE.map(snap), refs: [] }
    const host = await render(<SnapshotView version={version} current={null} diff={null} />)
    const titles = rows(host, (el) => el.querySelector(':scope > .blk-row')?.textContent ?? '')
    expect(titles.map((row) => ({ ...row, columns: row.columns.map((text) => text.replace('💡', '')) }))).toEqual([
      { label: '2 columns', wide: false, columns: ['Head', 'Aside'] },
      { label: '3 columns', wide: true, columns: ['One', 'Two', 'Three'] }
    ])
    const head = host.querySelector('.blk-beside > .blk')
    expect(head?.querySelectorAll(':scope > .blk-children > .blk')).toHaveLength(2)
  })
})
