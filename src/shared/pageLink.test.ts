import { describe, expect, it } from 'vitest'
import { pageLink, parsePageLink } from './pageLink'

const PAGE = '6f1c0a4e-1111-4222-8333-444455556666'
const BLOCK = 'b-1'

describe('page links', () => {
  it('writes the address of a page or of a block on it', () => {
    expect(pageLink(PAGE)).toBe(`sel://page/${PAGE}`)
    expect(pageLink(PAGE, BLOCK)).toBe(`sel://page/${PAGE}#${BLOCK}`)
  })

  it('reads back what it writes', () => {
    expect(parsePageLink(pageLink(PAGE))).toEqual({ pageId: PAGE })
    expect(parsePageLink(pageLink(PAGE, BLOCK))).toEqual({ pageId: PAGE, blockId: BLOCK })
  })

  it.each([
    null,
    42,
    '',
    `sel://${PAGE}#${BLOCK}`,
    `sel://page/`,
    `sel://page/${PAGE}/x`,
    `sel://page/${PAGE}#`,
    `sel://page/${PAGE}?q=1`,
    `sel://page/a b`,
    `sel://page/${'a'.repeat(65)}`,
    `SEL://PAGE/${PAGE}`,
    ` sel://page/${PAGE}`,
    `https://example.com/sel://page/${PAGE}`,
    'sel://page/__proto__',
    `sel-file://files/x.png`
  ])('refuses %j', (href) => {
    expect(parsePageLink(href)).toBeNull()
  })
})
