// The templates sel ships with, in the order the gallery shows them. Each is built for one
// language on demand: the same structure (keys, properties, views) in both, with words, example
// rows and amounts of its own. Pure data: main makes the blocks from it (main/templates), the
// gallery reads it to show what a template holds (renderer/src/templates).
import { fitColumns } from './build'
import { finances } from './finances'
import { household } from './household'
import { kitchen } from './kitchen'
import { library } from './library'
import type { Template, TemplateId, TemplateLocale } from './model'
import { project } from './project'
import { studies } from './studies'
import { trip } from './trip'

export * from './model'

const BUILDERS: Record<TemplateId, (locale: TemplateLocale) => Template> = {
  finances,
  household,
  trip,
  project,
  library,
  studies,
  kitchen
}

/** One template in one language. */
export function getTemplate(id: TemplateId, locale: TemplateLocale): Template {
  return fitColumns(BUILDERS[id](locale))
}

/** Every template in one language, in gallery order. */
export function listTemplates(locale: TemplateLocale): Template[] {
  return (Object.keys(BUILDERS) as TemplateId[]).map((id) => getTemplate(id, locale))
}
