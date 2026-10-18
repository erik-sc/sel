// What the gallery shows of a template before it is used: its sections (the headings of its
// page) and, under each, the databases, linked views and pages it makes. Pure.
import { plainText } from '../../../shared/richtext'
import type { Template, TemplateNode } from '../../../shared/templates/model'
import type { ViewType } from '../../../shared/types'

export type OutlineItem =
  | { kind: 'section'; title: string }
  | { kind: 'database'; title: string; icon?: string; properties: number; rows: number; views: ViewType[] }
  | { kind: 'linked'; title: string; source: string; views: ViewType[] }
  | { kind: 'page'; title: string; icon?: string }

/** The template's page read top to bottom, as the outline lists it. */
export function templateOutline(template: Template): OutlineItem[] {
  const titles = new Map<string, string>()
  const walk = (nodes: TemplateNode[], visit: (node: TemplateNode) => void): void => {
    for (const node of nodes) {
      visit(node)
      if (node.kind === 'block') walk(node.children ?? [], visit)
    }
  }
  const top = template.page.children ?? []
  walk(top, (node) => {
    if (node.kind === 'database') titles.set(node.key, node.title)
  })
  const unique = (types: ViewType[]): ViewType[] => [...new Set(types)]
  const out: OutlineItem[] = []
  walk(top, (node) => {
    if (node.kind === 'database') {
      out.push({
        kind: 'database',
        title: node.title,
        ...(node.icon ? { icon: node.icon } : {}),
        properties: Object.keys(node.schema).length,
        rows: node.rows.length,
        views: unique(node.views.map((v) => v.type))
      })
    } else if (node.kind === 'linked') {
      const source = titles.get(node.source) ?? ''
      out.push({ kind: 'linked', title: node.title ?? source, source, views: unique(node.views.map((v) => v.type)) })
    } else if (node.type === 'heading_1' || node.type === 'heading_2') {
      out.push({ kind: 'section', title: plainText(node.props?.title ?? []) })
    } else if (node.type === 'page') {
      out.push({ kind: 'page', title: plainText(node.props?.title ?? []), ...(node.props?.icon ? { icon: node.props.icon } : {}) })
    }
  })
  // A heading with nothing under it says nothing about the template.
  return out.filter((item, i) => item.kind !== 'section' || (out[i + 1] !== undefined && out[i + 1].kind !== 'section'))
}
