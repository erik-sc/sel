// Pasted HTML (a web page, an e-mail, Google Docs) as blocks of our own. Only the structure
// comes through: headings, paragraphs, lists, to-dos, quotes, code and dividers, with bold,
// italic, underline, strikethrough, inline code and links. Styles, colours, fonts, forms and
// scripts never do, and neither do images: showing one would fetch it from the network.
// The DOM comes from DOMParser (an inert document: nothing in it runs or loads); this module
// only walks it, through the few members of Node it needs. Pure; unit tested.
import type { BlockType, Mark, RichText } from '@shared/types'
import { parseClipNodes, type ClipNode } from './clipboard'
import { normalize, normalizeMarks } from './richtext-dom'
import { sanitizeHref } from './sanitize'

/** The part of a DOM node the conversion reads. */
export interface HtmlNode {
  readonly nodeType: number
  readonly nodeName: string
  readonly textContent: string | null
  readonly childNodes: ArrayLike<HtmlNode>
  getAttribute?(name: string): string | null
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3

/** Clipboard HTML longer than this is pasted as plain text. */
export const MAX_HTML_LENGTH = 2_000_000
/** Elements nested deeper than this are read as plain text. */
const MAX_DEPTH = 64
/** A document with more nodes than this is pasted as plain text. */
const MAX_VISITED = 100_000

/** Never read: what they hold is not text the user meant to paste, or would need the network. */
const SKIP: ReadonlySet<string> = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK', 'BASE', 'NOSCRIPT', 'IFRAME', 'FRAME', 'OBJECT',
  'EMBED', 'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'PICTURE', 'SOURCE', 'IMG', 'BUTTON', 'SELECT', 'TEXTAREA',
  'OPTION', 'INPUT', 'DIALOG'
])

/** Elements that stand for a block of their own. */
const STRUCTURE: ReadonlySet<string> = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE'])

/** Elements that only group blocks: their text runs become paragraphs. */
const CONTAINERS: ReadonlySet<string> = new Set([
  'HTML', 'BODY', 'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION',
  'CENTER', 'FORM', 'FIELDSET', 'LEGEND', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD', 'ADDRESS', 'CAPTION', 'THEAD', 'TBODY',
  'TFOOT', 'TR', 'TD', 'TH'
])

const HEADINGS: Readonly<Record<string, BlockType>> = {
  H1: 'heading_1',
  H2: 'heading_2',
  H3: 'heading_3',
  H4: 'heading_3',
  H5: 'heading_3',
  H6: 'heading_3'
}

const LANGUAGE_CLASS = /(?:^|\s)(?:language|lang)-([\w+#-]{1,32})/

function tagOf(n: HtmlNode): string | null {
  return n.nodeType === ELEMENT_NODE ? n.nodeName.toUpperCase() : null
}

function attr(n: HtmlNode, name: string): string | null {
  return n.getAttribute?.(name) ?? null
}

function isBlockLevel(tag: string | null): boolean {
  return !!tag && (STRUCTURE.has(tag) || CONTAINERS.has(tag))
}

/** One CSS declaration's value from a `style` attribute, lower case; '' when absent. */
function styleValue(style: string, property: string): string {
  const m = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]*)`, 'i').exec(style)
  return m ? m[1].trim().toLowerCase() : ''
}

function boldWeight(weight: string): boolean | null {
  if (!weight) return null
  if (weight === 'bold' || weight === 'bolder') return true
  const n = Number(weight)
  return Number.isFinite(n) ? n >= 600 : false
}

/**
 * The marks `el` adds to (or, through its style, takes from) the ones it inherits. Google Docs
 * wraps a whole copy in `<b style="font-weight:normal">` and puts real bold in a span's style.
 */
function marksFor(el: HtmlNode, tag: string, inherited: readonly Mark[]): Mark[] {
  const style = attr(el, 'style') ?? ''
  const weight = boldWeight(styleValue(style, 'font-weight'))
  const fontStyle = styleValue(style, 'font-style')
  const decoration = `${styleValue(style, 'text-decoration')} ${styleValue(style, 'text-decoration-line')}`
  let marks = [...inherited]
  const add = (mark: Mark): void => {
    marks.push(mark)
  }
  const drop = (kind: string): void => {
    marks = marks.filter((m) => m[0] !== kind)
  }
  if ((tag === 'B' || tag === 'STRONG') && weight !== false) add(['b'])
  if (tag === 'I' || tag === 'EM') add(['i'])
  if (tag === 'U' || tag === 'INS') add(['u'])
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') add(['s'])
  if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') add(['c'])
  if (tag === 'A') {
    const href = sanitizeHref(attr(el, 'href'))
    if (href) add(['a', href])
  }
  if (weight === true) add(['b'])
  else if (weight === false) drop('b')
  if (fontStyle === 'italic' || fontStyle === 'oblique') add(['i'])
  else if (fontStyle === 'normal') drop('i')
  if (decoration.includes('underline')) add(['u'])
  if (decoration.includes('line-through')) add(['s'])
  return normalizeMarks(marks)
}

/**
 * Collapses whitespace the way a browser shows it: no runs of spaces, no spaces next to a line
 * break, no blank lines, nothing leading or trailing.
 */
export function tidy(rt: RichText): RichText {
  const out: RichText = []
  let prev = '\n'
  for (const [text, marks] of rt) {
    let t = ''
    for (const ch of text) {
      if (ch === ' ' && (prev === ' ' || prev === '\n')) continue
      if (ch === '\n') {
        if (prev === '\n') continue
        if (prev === ' ') {
          if (t) t = t.slice(0, -1)
          else {
            const last = out[out.length - 1]
            if (last) last[0] = last[0].slice(0, -1)
          }
        }
      }
      t += ch
      prev = ch
    }
    if (t) out.push(marks?.length ? [t, marks] : [t])
  }
  for (let last = out[out.length - 1]; last; last = out[out.length - 1]) {
    last[0] = last[0].replace(/[ \n]+$/, '')
    if (last[0]) break
    out.pop()
  }
  return normalize(out)
}

function textNode(type: BlockType, title: RichText, children: ClipNode[] = []): ClipNode {
  return { type, props: { title }, children }
}

/** The checkbox of a task-list item (GitHub's `<input type=checkbox>`, Google Docs' `role=checkbox`), if any. */
function checkboxOf(li: HtmlNode): boolean | null {
  if (attr(li, 'role') === 'checkbox') return attr(li, 'aria-checked') === 'true'
  const find = (n: HtmlNode, depth: number): boolean | null => {
    for (const child of Array.from(n.childNodes)) {
      const tag = tagOf(child)
      if (!tag || tag === 'UL' || tag === 'OL') continue
      if (tag === 'INPUT') {
        if ((attr(child, 'type') ?? '').toLowerCase() === 'checkbox') return attr(child, 'checked') !== null
        continue
      }
      if (depth < 3) {
        const found = find(child, depth + 1)
        if (found !== null) return found
      }
    }
    return null
  }
  return find(li, 0)
}

/** Whether a table cell holds blocks of its own (a layout table) rather than a value. */
function holdsBlocks(n: HtmlNode, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false
  for (const child of Array.from(n.childNodes)) {
    const tag = tagOf(child)
    if (tag && STRUCTURE.has(tag)) return true
    if (tag && holdsBlocks(child, depth + 1)) return true
  }
  return false
}

/** Whether any element below `n` is block-level. */
function holdsBlockLevel(n: HtmlNode, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false
  for (const child of Array.from(n.childNodes)) {
    const tag = tagOf(child)
    if (!tag || SKIP.has(tag)) continue
    if (isBlockLevel(tag) || holdsBlockLevel(child, depth + 1)) return true
  }
  return false
}

/** Too deep to walk any further: the text of `el` as one block of `type`. */
function plainBlock(el: HtmlNode, type: BlockType, out: ClipNode[]): void {
  const title = tidy([[(el.textContent ?? '').replace(/\s+/g, ' ')]])
  if (title.length) out.push(textNode(type, title))
}

/** A parent holding just `n`, to read one stray element as blocks. */
function wrap(n: HtmlNode): HtmlNode {
  return { nodeType: ELEMENT_NODE, nodeName: 'DIV', textContent: null, childNodes: [n] }
}

class Converter {
  private visited = 0

  get exhausted(): boolean {
    return this.visited > MAX_VISITED
  }

  /** The children of `parent` as blocks: block elements in turn, runs of inline content as paragraphs. */
  blocks(parent: HtmlNode, out: ClipNode[], depth: number): void {
    let run: RichText = []
    const flush = (): void => {
      const title = tidy(run)
      run = []
      if (title.length) out.push(textNode('text', title))
    }
    for (const child of Array.from(parent.childNodes)) {
      if (this.exhausted) return
      const tag = tagOf(child)
      if (tag && isBlockLevel(tag)) {
        flush()
        this.block(child, tag, out, depth + 1)
      } else if (tag && !SKIP.has(tag) && depth < MAX_DEPTH && holdsBlockLevel(child)) {
        // An inline element around blocks, such as the <b> Google Docs wraps a whole copy in:
        // the blocks matter more than what the wrapper would add to them.
        flush()
        this.blocks(child, out, depth + 1)
      } else this.inline(child, [], run, depth + 1)
    }
    flush()
  }

  private block(el: HtmlNode, tag: string, out: ClipNode[], depth: number): void {
    if (++this.visited > MAX_VISITED) return
    if (depth > MAX_DEPTH) return plainBlock(el, 'text', out)
    const heading = HEADINGS[tag]
    if (heading) {
      const title = this.flat(el, depth)
      if (title.length) out.push(textNode(heading, title))
    } else if (tag === 'UL' || tag === 'OL') this.list(el, tag === 'OL' ? 'numbered_list' : 'bulleted_list', out, depth)
    else if (tag === 'LI') this.item(el, 'bulleted_list', out, depth)
    else if (tag === 'BLOCKQUOTE') {
      const title = this.flat(el, depth)
      if (title.length) out.push(textNode('quote', title))
    } else if (tag === 'PRE') this.code(el, out)
    else if (tag === 'HR') out.push({ type: 'divider', props: {}, children: [] })
    else if (tag === 'TABLE') this.table(el, out, depth)
    else this.blocks(el, out, depth)
  }

  /** Inline content of `el`, its block-level parts on lines of their own. */
  private flat(el: HtmlNode, depth: number): RichText {
    const rt: RichText = []
    for (const child of Array.from(el.childNodes)) this.inline(child, [], rt, depth + 1)
    return tidy(rt)
  }

  private inline(n: HtmlNode, marks: readonly Mark[], out: RichText, depth: number): void {
    if (++this.visited > MAX_VISITED) return
    if (n.nodeType === TEXT_NODE) {
      const text = (n.textContent ?? '').replace(/[ \t\n\r\f ]+/g, ' ')
      if (text) out.push(marks.length ? [text, [...marks]] : [text])
      return
    }
    const tag = tagOf(n)
    if (!tag || SKIP.has(tag)) return
    if (tag === 'BR') {
      out.push(['\n'])
      return
    }
    if (depth > MAX_DEPTH) {
      out.push([(n.textContent ?? '').replace(/\s+/g, ' ')])
      return
    }
    const block = isBlockLevel(tag)
    if (block) out.push(['\n'])
    const next = marksFor(n, tag, marks)
    for (const child of Array.from(n.childNodes)) this.inline(child, next, out, depth + 1)
    if (block) out.push(['\n'])
  }

  /**
   * The items of a list. A nested list sits inside its item, or (as Google Docs and some
   * editors write it) right after it, or the items carry their level in `aria-level`.
   */
  private list(el: HtmlNode, type: BlockType, out: ClipNode[], depth: number): void {
    if (depth > MAX_DEPTH) return plainBlock(el, type, out)
    const levels: { level: number; node: ClipNode }[] = []
    let last: ClipNode | null = null
    for (const child of Array.from(el.childNodes)) {
      if (this.exhausted) return
      const tag = tagOf(child)
      if (tag === 'LI') {
        const level = Number(attr(child, 'aria-level'))
        let target = out
        if (Number.isInteger(level) && level > 0) {
          while (levels.length && levels[levels.length - 1].level >= level) levels.pop()
          if (levels.length) target = levels[levels.length - 1].node.children
        }
        const added = this.item(child, type, target, depth + 1)
        if (added) {
          last = added
          if (Number.isInteger(level) && level > 0) levels.push({ level, node: added })
        }
      } else if (tag === 'UL' || tag === 'OL') {
        this.list(child, tag === 'OL' ? 'numbered_list' : 'bulleted_list', last ? last.children : out, depth + 1)
      } else if (tag && !SKIP.has(tag)) this.blocks(wrap(child), out, depth)
    }
  }

  /** One list item: its text, then its nested lists as children. Null when it holds nothing. */
  private item(li: HtmlNode, type: BlockType, out: ClipNode[], depth: number): ClipNode | null {
    if (++this.visited > MAX_VISITED) return null
    if (depth > MAX_DEPTH) {
      plainBlock(li, type, out)
      return null
    }
    const checked = checkboxOf(li)
    const run: RichText = []
    const children: ClipNode[] = []
    for (const child of Array.from(li.childNodes)) {
      const tag = tagOf(child)
      if (tag === 'UL' || tag === 'OL') this.list(child, tag === 'OL' ? 'numbered_list' : 'bulleted_list', children, depth + 1)
      else this.inline(child, [], run, depth + 1)
    }
    const title = tidy(run)
    if (!title.length && !children.length) return null
    const node: ClipNode =
      checked === null ? textNode(type, title, children) : { type: 'to_do', props: { title, checked }, children }
    out.push(node)
    return node
  }

  /** A `<pre>`: its text as it stands, one code block. */
  private code(el: HtmlNode, out: ClipNode[]): void {
    let text = ''
    const walk = (n: HtmlNode, depth: number): void => {
      if (++this.visited > MAX_VISITED || depth > MAX_DEPTH) return
      if (n.nodeType === TEXT_NODE) {
        text += n.textContent ?? ''
        return
      }
      const tag = tagOf(n)
      if (!tag || SKIP.has(tag)) return
      if (tag === 'BR') {
        text += '\n'
        return
      }
      // Some highlighters put each line in a block of its own instead of using newlines.
      const line = isBlockLevel(tag) && text !== '' && !text.endsWith('\n')
      if (line) text += '\n'
      for (const child of Array.from(n.childNodes)) walk(child, depth + 1)
    }
    for (const child of Array.from(el.childNodes)) walk(child, 1)
    const body = text.replace(/\r\n?/g, '\n').replace(/^\n/, '').replace(/\n+$/, '')
    const codeChild = Array.from(el.childNodes).find((n) => tagOf(n) === 'CODE')
    const language = LANGUAGE_CLASS.exec(`${attr(el, 'class') ?? ''} ${codeChild ? (attr(codeChild, 'class') ?? '') : ''}`)?.[1]
    out.push({ type: 'code', props: { title: body ? [[body]] : [], ...(language ? { language } : {}) }, children: [] })
  }

  /**
   * A data table becomes one line per row, its cells joined by " | " (it does not become a
   * database). A layout table, as e-mails are built of, is read through to the blocks it holds.
   */
  private table(el: HtmlNode, out: ClipNode[], depth: number): void {
    const rows: HtmlNode[] = []
    const collect = (n: HtmlNode, d: number): void => {
      for (const child of Array.from(n.childNodes)) {
        const tag = tagOf(child)
        if (tag === 'TR') rows.push(child)
        else if ((tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT') && d < 2) collect(child, d + 1)
        else if (tag === 'CAPTION') this.blocks(child, out, depth + 1)
      }
    }
    collect(el, 0)
    for (const row of rows) {
      if (this.exhausted) return
      const cells = Array.from(row.childNodes).filter((n) => tagOf(n) === 'TD' || tagOf(n) === 'TH')
      if (cells.length === 1 || cells.some((cell) => holdsBlocks(cell))) {
        for (const cell of cells) this.blocks(cell, out, depth + 2)
        continue
      }
      const line: RichText = []
      for (const cell of cells) {
        const text = this.flat(cell, depth + 2).map(([t, m]): RichText[number] => [t.replace(/\n/g, ' '), m ?? []])
        if (!text.length) continue
        if (line.length) line.push([' | '])
        line.push(...text)
      }
      const title = tidy(line)
      if (title.length) out.push(textNode('text', title))
    }
  }
}

/** Whether the document holds anything plain text would lose: block structure, marks or links. */
function hasStructure(root: HtmlNode): { blocks: boolean; marks: boolean } {
  const found = { blocks: false, marks: false }
  let budget = MAX_VISITED
  const walk = (n: HtmlNode, depth: number): void => {
    for (const child of Array.from(n.childNodes)) {
      if (--budget < 0 || found.blocks || depth > MAX_DEPTH) return
      const tag = tagOf(child)
      if (!tag || SKIP.has(tag)) continue
      if (STRUCTURE.has(tag)) found.blocks = true
      else if (!found.marks && marksFor(child, tag, []).length) found.marks = true
      walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return found
}

/** Plain text that is itself Markdown: a line starting a heading, a list item, a quote or a fence. */
const MARKDOWN_LINE = /^\s{0,3}(#{1,6}\s|[-*+]\s|\d{1,3}[.)]\s|>|```)/m

/** A code editor's copy (VS Code and others): one `white-space: pre` box of coloured spans. */
function isEditorCopy(root: HtmlNode): boolean {
  const first = Array.from(root.childNodes).find((n) => n.nodeType === ELEMENT_NODE)
  return !!first && tagOf(first) === 'DIV' && /white-space\s*:\s*pre\s*(;|$)/i.test(attr(first, 'style') ?? '')
}

/**
 * The blocks for pasted HTML (`body` of the parsed clipboard document), or null when the
 * HTML adds nothing to the plain text (`plain`), which then goes the plain-text/Markdown way.
 * Everything returned has been through the clipboard's own validation (`parseClipNodes`).
 */
export function htmlToNodes(body: HtmlNode | null | undefined, plain: string): ClipNode[] | null {
  if (!body || isEditorCopy(body)) return null
  const found = hasStructure(body)
  if (!found.blocks && !found.marks) return null
  // Markdown source shown with some styling: its own syntax says more than the styling does.
  if (!found.blocks && MARKDOWN_LINE.test(plain)) return null
  const converter = new Converter()
  const nodes: ClipNode[] = []
  converter.blocks(body, nodes, 0)
  if (converter.exhausted) return null
  const clean = parseClipNodes(nodes)
  return clean.length ? clean : null
}
