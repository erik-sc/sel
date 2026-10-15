import { readAlarmSettings } from '../../shared/alarms'
import type { Handlers } from '../invoke'
import type { AlarmsBridge, AlarmsContext } from './index'

/**
 * The `alarms:*` channels, and the start of the alarms' clock. This file is all of the alarms
 * that loads with the main process; the clock itself (./index.ts) is imported a few seconds
 * after start-up, out of the way of the first window, and runs from then on.
 */

/** The clock starts this long after the app is ready: the first window paints first. */
const START_DELAY_MS = 4000

export interface AlarmsHooks {
  handlers: Handlers<'alarms'>
  /** A setting was written; the clock follows when it is one of the alarms'. */
  settingChanged(key: string): void
  /** sel stays running in the notification area when its last window closes. */
  keepRunning(): boolean
  /** sel was started by the system at login, to wait in the notification area. */
  startHidden(argv: readonly string[]): boolean
}

export function registerAlarmsIpc(ctx: AlarmsContext): AlarmsHooks {
  let bridge: AlarmsBridge | null = null
  let loading: Promise<AlarmsBridge> | null = null
  const alarms = (): Promise<AlarmsBridge> => (loading ??= import('./index').then(({ AlarmsBridge }) => (bridge = new AlarmsBridge(ctx))))
  setTimeout(() => void alarms().catch((err: unknown) => console.error('[alarms] could not start', err)), START_DELAY_MS).unref()
  const tray = (): boolean => readAlarmSettings((key) => ctx.repo.getSetting(key)).tray

  return {
    handlers: {
      'alarms:pending': async () => (await alarms()).service.pendingAnnouncement(),
      'alarms:heard': async ([id]) => (await alarms()).service.heard(id),
      'alarms:test': async () => (await alarms()).service.test()
    },
    settingChanged(key) {
      if (key.startsWith('alarms.')) bridge?.settingChanged()
    },
    keepRunning: tray,
    startHidden: (argv) => argv.includes('--sel-hidden') && tray()
  }
}
