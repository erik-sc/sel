import { randomUUID } from 'node:crypto'
import type { BlockProps, BlockType, DatabaseView, Op, PropertySchema, RichText } from '../../shared/types'
import type { Repository } from './repository'

const SEEDED_KEY = 'seeded'

/** Creates the welcome content the first time the database is opened. Returns the page id. */
export function seedIfEmpty(repo: Repository): string | null {
  if (repo.getSetting(SEEDED_KEY) || !repo.isEmpty()) return null
  const id = seed(repo)
  repo.setSetting(SEEDED_KEY, true)
  repo.drainChanges()
  return id
}

function seed(repo: Repository): string {
  const ops: Op[] = []
  const add = (type: BlockType, parentId: string | null, props: BlockProps = {}): string => {
    const id = randomUUID()
    ops.push({ op: 'create', input: { id, type, parentId, props } })
    return id
  }
  const t = (text: string): RichText => [[text]]

  const page = add('page', null, { title: t('Getting Started'), icon: '👋' })
  add('text', page, {
    title: [
      ['Welcome to '],
      ['sel', [['b']]],
      [' — a local-first workspace. Everything here is a block, and everything lives in a file on '],
      ['your', [['i']]],
      [' computer.']
    ]
  })
  add('callout', page, {
    icon: '💡',
    title: [['Type '], ['/', [['c']]], [' on an empty line to insert any kind of block.']],
    color: 'yellow_background'
  })

  add('heading_2', page, { title: t('The basics') })
  add('to_do', page, { title: t('Click this checkbox'), checked: true })
  add('to_do', page, { title: t('Create a page from the sidebar'), checked: false })
  add('to_do', page, { title: [['Press '], ['Ctrl+P', [['c']]], [' to find anything']], checked: false })

  add('heading_2', page, { title: t('Blocks') })
  const bullet = add('bulleted_list', page, { title: t('Lists can be nested') })
  add('bulleted_list', bullet, { title: t('Like this — press Tab to indent') })
  add('bulleted_list', page, {
    title: [
      ['Text can be '],
      ['bold', [['b']]],
      [', '],
      ['italic', [['i']]],
      [', '],
      ['underlined', [['u']]],
      [', '],
      ['struck through', [['s']]],
      [' or '],
      ['code', [['c']]]
    ]
  })
  add('numbered_list', page, { title: t('Numbered lists count for you') })
  add('numbered_list', page, { title: t('Drag the handle on the left to reorder blocks') })
  const toggle = add('toggle', page, { title: t('Toggles hide details (click the arrow)'), collapsed: true })
  add('text', toggle, { title: t('Anything can live inside a toggle, even other toggles.') })
  add('quote', page, { title: t('Simplicity is the ultimate sophistication.') })
  add('code', page, {
    language: 'typescript',
    title: t('function greet(name: string): string {\n  return `Olá, ${name}!`\n}')
  })
  add('divider', page)

  add('heading_2', page, { title: t('Databases') })
  add('text', page, {
    title: t('A database is a collection of pages with properties. Each row below opens as its own page.')
  })

  const status: PropertySchema = {
    id: 'status',
    name: 'Status',
    type: 'select',
    options: [
      { id: 'todo', name: 'To do', color: 'gray' },
      { id: 'doing', name: 'In progress', color: 'blue' },
      { id: 'done', name: 'Done', color: 'green' }
    ]
  }
  const schema: Record<string, PropertySchema> = {
    title: { id: 'title', name: 'Name', type: 'title' },
    status,
    due: { id: 'due', name: 'Due', type: 'date' },
    done: { id: 'done', name: 'Done', type: 'checkbox' }
  }
  const order = ['title', 'status', 'due', 'done']
  const views: DatabaseView[] = [
    { id: randomUUID(), name: 'Table', type: 'table', visibleProperties: order, filters: [], sorts: [] },
    { id: randomUUID(), name: 'Board', type: 'board', visibleProperties: order, filters: [], sorts: [], groupBy: 'status' }
  ]
  const database = add('database', page, { title: t('Tasks'), icon: '✅', schema, views })

  const day = (offset: number): string => {
    const d = new Date(Date.now() + offset * 86_400_000)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  add('page', database, {
    title: t('Read this page'),
    values: { status: 'done', due: { start: day(0) }, done: true }
  })
  add('page', database, {
    title: t('Write my first note'),
    values: { status: 'doing', due: { start: day(1) }, done: false }
  })
  add('page', database, {
    title: t('Organize a project'),
    values: { status: 'todo', due: { start: day(7) }, done: false }
  })

  repo.apply(ops)
  return page
}
