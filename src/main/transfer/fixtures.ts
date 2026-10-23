/**
 * Test-only: small exports the way Notion and Obsidian write them, as maps of path to content.
 * Not imported by the app bundle.
 */

/** The eight bytes that start every PNG, and a little more: enough for `sniffImage`. */
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1])

const P = '0123456789abcdef0123456789abcdef'
const R = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const T = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const M = 'cccccccccccccccccccccccccccccccc'
const W = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const enc = (s: string): string => encodeURIComponent(s)

/**
 * A Notion export: a page with a sub-page (which shows an image and links to a PDF), a database
 * (`_all.csv` beside the view's CSV) with a row that has a page of its own, a page linked by its
 * notion.so address, and a link to a page that was not exported.
 */
export const NOTION_EXPORT: Record<string, string | Uint8Array> = {
  [`Projects ${P}.md`]: [
    '# Projects',
    '',
    'Our projects live here.',
    '',
    `[Roadmap](${enc(`Projects ${P}`)}/${enc(`Roadmap ${R}.md`)})`,
    '',
    `[Tasks](${enc(`Projects ${P}`)}/${enc(`Tasks ${T}.csv`)})`,
    '',
    `See [the meeting](https://www.notion.so/Meeting-${M}?pvs=21) and [a lost page](${enc(`Elsewhere ${'d'.repeat(32)}.md`)}).`,
    ''
  ].join('\n'),
  [`Projects ${P}/Roadmap ${R}.md`]: [
    '# Roadmap',
    '',
    `![diagram.png](${enc(`Roadmap ${R}`)}/diagram.png)`,
    '',
    `The [spec](${enc(`Roadmap ${R}`)}/spec.pdf) is attached.`,
    ''
  ].join('\n'),
  [`Projects ${P}/Roadmap ${R}/diagram.png`]: PNG,
  [`Projects ${P}/Roadmap ${R}/spec.pdf`]: '%PDF-1.4 not really',
  [`Projects ${P}/Tasks ${T}.csv`]: [
    'Name,Status,Tags,Due,Done,Estimate',
    'Write spec,In progress,"docs, urgent","October 22, 2026",No,3',
    'Ship it,Done,urgent,"October 30, 2026 3:00 PM",Yes,5',
    ''
  ].join('\n'),
  [`Projects ${P}/Tasks ${T}_all.csv`]: [
    '﻿Name,Status,Tags,Due,Done,Estimate',
    'Write spec,In progress,"docs, urgent","October 22, 2026",No,3',
    'Ship it,Done,urgent,"October 30, 2026 3:00 PM",Yes,5',
    'Celebrate,Done,,,No,',
    ''
  ].join('\r\n'),
  [`Projects ${P}/Tasks ${T}/Write spec ${W}.md`]: [
    '# Write spec',
    '',
    'Status: In progress',
    'Tags: docs, urgent',
    'Due: October 22, 2026',
    '',
    `The spec follows the [roadmap](../${enc(`Roadmap ${R}.md`)}).`,
    ''
  ].join('\n'),
  [`Meeting ${M}.md`]: '# Meeting\n\nNotes from the meeting.\n'
}

/**
 * An Obsidian vault: front matter, wikilinks with aliases and headings, an image and a PDF
 * embedded, a link to a note that does not exist, a Markdown link, a folder with a note of its
 * name and one without, and the app's own folder, which is not part of the notes.
 */
export const OBSIDIAN_VAULT: Record<string, string | Uint8Array> = {
  'Home.md': [
    '---',
    'tags: [index, start]',
    'icon: 🏠',
    '---',
    '# Home',
    '',
    'Welcome. See [[Daily/2026-10-22|today]] and [[Ideas]].',
    '',
    '![[photo.png]]',
    '',
    'The paper: ![[paper.pdf]]',
    '',
    '[[Nowhere]] is not here.',
    '',
    '```',
    '[[Not a link]] inside code',
    '```',
    ''
  ].join('\n'),
  'Ideas.md': ['- [[Home#Welcome|back home]]', '- [Markdown link](Daily/2026-10-22.md)', ''].join('\n'),
  'Daily/2026-10-22.md': 'Wrote [[Ideas]].\n',
  'Projects.md': 'All projects.\n',
  'Projects/Alpha.md': 'Alpha, under [[Projects]].\n',
  'attachments/photo.png': PNG,
  'attachments/paper.pdf': '%PDF-1.4 not really',
  '.obsidian/app.json': '{}'
}
