import { describe, expect, it, vi } from 'vitest'
import type { Block } from '@shared/types'
import { HOME_COPY, homeLocale } from './copy'

vi.stubGlobal('window', { api: { clientId: 'w', onChange: () => () => {}, app: { platform: 'win32' } } })
const { homeHint, homeStatus } = await import('./store')

const page = (trashed: boolean): Block =>
  ({
    id: 'p',
    type: 'page',
    parentId: null,
    content: [],
    props: {},
    createdAt: 1,
    updatedAt: 1,
    trashedAt: trashed ? 2 : null
  }) as unknown as Block

describe('the home', () => {
  it('can open a screen, or a page that is here and not in the Trash', () => {
    expect(homeStatus(null, undefined, 'missing')).toBe('none')
    expect(homeStatus({ kind: 'screen', route: '_today' }, undefined, 'missing')).toBe('ready')
    expect(homeStatus({ kind: 'page', id: 'p' }, page(false), 'ready')).toBe('ready')
    expect(homeStatus({ kind: 'page', id: 'p' }, page(true), 'ready')).toBe('trashed')
    expect(homeStatus({ kind: 'page', id: 'p' }, undefined, 'missing')).toBe('missing')
    expect(homeStatus({ kind: 'page', id: 'p' }, undefined, 'loading')).toBe('loading')
  })

  it('says why the Home button cannot open it', () => {
    const copy = HOME_COPY['pt-BR']
    expect(homeHint('trashed', copy)).toBe('A home foi para a lixeira')
    expect(homeHint('missing', copy)).toBe(copy.missing)
    expect(homeHint('none', copy)).toBe(copy.choose)
    expect(homeHint('ready', copy)).toBeNull()
    expect(homeHint('loading', copy)).toBeNull()
  })

  it('speaks the language set for AI answers, else the system one', () => {
    expect(homeLocale('pt-BR', 'en-US')).toBe('pt-BR')
    expect(homeLocale('en', 'pt-BR')).toBe('en')
    expect(homeLocale(null, 'pt-BR')).toBe('pt-BR')
    expect(homeLocale(undefined, 'pt')).toBe('pt-BR')
    expect(homeLocale(null, 'de-DE')).toBe('en')
    expect(Object.keys(HOME_COPY.en).sort()).toEqual(Object.keys(HOME_COPY['pt-BR']).sort())
  })
})
