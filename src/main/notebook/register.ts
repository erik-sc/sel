import { app } from 'electron'
import type { Repository } from '../db/repository'
import type { Handlers } from '../invoke'
import type { NotebookService } from './service'

/**
 * The `notebook:*` channels: the ink notebook. This file is all of
 * it that loads at start-up; the service is imported when a window first asks. Every handler is
 * registered by ../ipc.ts behind its wrapper, which checks the sender and reduces failures to
 * safe messages, and every argument is validated by the service before it is used. What they
 * write reaches the windows as an ordinary change, and syncs like any other block.
 */
export function registerNotebookIpc({ repo }: { repo: Repository }): Handlers<'notebook'> {
  let service: NotebookService | null = null
  const notebook = async (): Promise<NotebookService> =>
    (service ??= new (await import('./service')).NotebookService({ repo, systemLocale: () => app.getLocale() }))

  return {
    'notebook:get': async () => (await notebook()).get(),
    'notebook:write': async ([day, text]) => (await notebook()).write(day, text)
  }
}
