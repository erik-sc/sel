import { app, BrowserWindow, dialog, globalShortcut } from 'electron'
import { basename } from 'node:path'
import {
  cleanAccelerator,
  cleanGlobalShortcut,
  GLOBAL_SHORTCUT_KEY,
  type GlobalShortcutSetting,
  type GlobalShortcutState,
  type TodoistImportResult
} from '../../shared/tasks/api'
import type { Repository } from '../db/repository'
import { readFileCapped } from '../fsutil'
import type { Handlers } from '../invoke'
import * as arg from '../validate'
import { importTodoistFiles } from './import'
import { refineFacts } from './refine'
import { TODOIST_LIMITS } from './todoist'
import { openQuickAddWindow } from './window'
import { defineFeature, type Registered } from '../feature'

/**
 * The `tasks:*` channels: importing Todoist exports (the dialog is opened here; the window never
 * names a path) and the system-wide quick-add shortcut, which is registered here at start-up
 * when the user turned it on, and released when the app quits.
 */
export function registerTasksIpc({ repo }: { repo: Repository }): { handlers: Handlers<'tasks'> } {
  let registered: string | null = null

  /** Applies a setting: the old keys are released, the new ones taken when it is on. */
  const apply = (setting: GlobalShortcutSetting): GlobalShortcutState => {
    if (registered) globalShortcut.unregister(registered)
    registered = null
    if (setting.enabled) {
      try {
        if (globalShortcut.register(setting.accelerator, () => openQuickAddWindow(repo))) registered = setting.accelerator
      } catch (err) {
        console.error('[main] could not register the quick-add shortcut', err)
      }
    }
    return { ...setting, registered: registered !== null }
  }

  let state = apply(cleanGlobalShortcut(repo.getSetting(GLOBAL_SHORTCUT_KEY)))
  app.on('will-quit', () => {
    if (registered) globalShortcut.unregister(registered)
  })

  const handlers: Handlers<'tasks'> = {
    'tasks:importTodoist': async (_args, event): Promise<TodoistImportResult> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: 'Import from Todoist',
        properties: ['openFile' as const, 'multiSelections' as const],
        filters: [{ name: 'Todoist export (CSV)', extensions: ['csv'] }]
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths.length) return { imported: false, tasks: 0, projects: [], skipped: 0 }
      const files: { name: string; text: string }[] = []
      for (const file of result.filePaths.slice(0, 50)) {
        const bytes = await readFileCapped(file, TODOIST_LIMITS.file, 'That file is too large to be a Todoist export.')
        files.push({ name: basename(file), text: bytes.toString('utf8') })
      }
      return importTodoistFiles(repo, files)
    },
    'tasks:globalShortcut': async () => state,
    'tasks:setGlobalShortcut': async ([raw]) => {
      const input = arg.plainObject(raw, 'shortcut')
      const accelerator = cleanAccelerator(input['accelerator'])
      if (!accelerator) throw new Error('That shortcut needs a modifier (Ctrl, Alt, Shift…) and one key.')
      const setting: GlobalShortcutSetting = { enabled: input['enabled'] === true, accelerator }
      repo.setSetting(GLOBAL_SHORTCUT_KEY, setting)
      state = apply(setting)
      return state
    },
    'tasks:refining': async () => ({ count: refineFacts(repo, Date.now()).count })
  }
  return { handlers }
}

/** Tasks beyond block edits: the Todoist import, the system-wide quick-add shortcut, the count of tasks to refine. */
export const tasksFeature = defineFeature({
  namespace: 'tasks',
  register: (ctx): Registered<'tasks'> => registerTasksIpc({ repo: ctx.repo })
})
