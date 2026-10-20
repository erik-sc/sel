import type { Repository } from '../db/repository'
import type { Handlers } from '../invoke'
import { isTemplateId, isTemplateLocale, type TemplateRequest } from '../../shared/templates/model'
import * as arg from '../validate'
import { defineFeature, type Registered } from '../feature'

/**
 * The `templates:*` channel: making a template's page. The templates themselves (pure data, the
 * same in every process) and the code that makes them are loaded the first time one is used.
 * The window names a template, a language and a place; it never sends blocks: what is written
 * comes from the template as main has it. Registered by ../ipc.ts behind its wrapper, which
 * checks the sender and reduces failures to safe messages.
 */
export function registerTemplatesIpc({ repo }: { repo: Repository }): Handlers<'templates'> {
  return {
    'templates:create': async ([a]) => {
      const request = templateRequest(a)
      const [{ getTemplate }, { instantiateTemplate }] = await Promise.all([import('../../shared/templates'), import('./instantiate')])
      return instantiateTemplate(repo, getTemplate(request.id, request.locale), {
        parentId: placeFor(repo, request.parentId),
        examples: request.examples
      })
    }
  }
}

/** The request as the renderer sent it, checked field by field. */
export function templateRequest(raw: unknown): TemplateRequest {
  const input = arg.plainObject(raw, 'request')
  if (!isTemplateId(input.id)) throw new Error('Unknown template')
  if (!isTemplateLocale(input.locale)) throw new Error('Unknown template language')
  if (typeof input.examples !== 'boolean') throw new Error('examples must be true or false')
  return { id: input.id, locale: input.locale, examples: input.examples, parentId: arg.nullableId(input.parentId, 'parentId') }
}

/** A template goes at the workspace root or inside a page that is not in the trash. */
function placeFor(repo: Repository, parentId: string | null): string | null {
  if (parentId === null) return null
  const parent = repo.get(parentId)
  if (!parent || parent.type !== 'page' || parent.trashedAt !== null) throw new Error('A template goes inside a page')
  return parentId
}

/** Templates: pages and databases made from a template in one transaction. */
export const templatesFeature = defineFeature({
  namespace: 'templates',
  register: (ctx): Registered<'templates'> => ({ handlers: registerTemplatesIpc({ repo: ctx.repo }) })
})
