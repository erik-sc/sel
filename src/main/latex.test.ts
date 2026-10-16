import { beforeEach, describe, expect, it } from 'vitest'
import type { Repository } from './db/repository'
import { openTestRepository } from './db/testing'
import { latexDocument, pdfPageSize } from './latex'

let repo: Repository

beforeEach(() => {
  repo = openTestRepository()
})

describe('latexDocument', () => {
  it('reads the source from the latex code block of the page', () => {
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Paper']], kind: 'latex' } })
    repo.create({ type: 'text', parentId: page.id, props: { title: [['not this']] } })
    repo.create({ type: 'code', parentId: page.id, props: { title: [['% other']], language: 'js' } })
    repo.create({ type: 'code', parentId: page.id, props: { title: [['\\documentclass{article}']], language: 'latex' } })
    expect(latexDocument(repo, page.id)).toEqual({ title: 'Paper', source: '\\documentclass{article}' })
  })

  it('is empty when the source block is gone, and refuses a page that is not a LaTeX document', () => {
    const page = repo.create({ type: 'page', parentId: null, props: { title: [], kind: 'latex' } })
    expect(latexDocument(repo, page.id)).toEqual({ title: 'Untitled', source: '' })
    const plain = repo.create({ type: 'page', parentId: null, props: { title: [['Notes']] } })
    expect(() => latexDocument(repo, plain.id)).toThrow('not a LaTeX document')
  })
})

describe('pdfPageSize', () => {
  it('takes A4 or Letter and nothing else', () => {
    expect(pdfPageSize('A4')).toBe('A4')
    expect(pdfPageSize('Letter')).toBe('Letter')
    expect(() => pdfPageSize('Legal')).toThrow()
    expect(() => pdfPageSize(undefined)).toThrow()
  })
})
