// Every feature of a window, the one list of them: each declares itself in its own folder
// (`<feature>/feature.ts`, see ./feature.ts). A feature adds itself here, one line. The order is
// the order their `init` runs in at start-up.
import { activityFeature } from './activity/feature'
import { aiFeature } from './ai/feature'
import { alarmsFeature } from './alarms/feature'
import { briefingFeature } from './briefing/feature'
import { feedbackFeature } from './feedback/feature'
import { flowsFeature } from './flows/feature'
import { hermanFeature } from './herman/feature'
import { homeFeature } from './home/feature'
import { meetingsFeature } from './meetings/feature'
import { notebookFeature } from './notebook/feature'
import { pomodoroFeature } from './pomodoro/feature'
import { shellFeature } from './shell/feature'
import { skyFeature } from './sky/feature'
import { syncFeature } from './sync/feature'
import { tasksFeature } from './tasks/feature'
import { templatesFeature } from './templates/feature'
import { transferFeature } from './transfer/feature'
import { updatesFeature } from './updates/feature'

export const FEATURES = [
  shellFeature,
  aiFeature,
  hermanFeature,
  syncFeature,
  meetingsFeature,
  updatesFeature,
  alarmsFeature,
  homeFeature,
  pomodoroFeature,
  skyFeature,
  templatesFeature,
  briefingFeature,
  tasksFeature,
  notebookFeature,
  feedbackFeature,
  activityFeature,
  transferFeature,
  flowsFeature
] as const

/** Runs every feature's start-up, in the order above. */
export function initFeatures(): void {
  for (const feature of FEATURES) feature.init?.()
}

/** Asks every feature to fetch what it will likely need soon. */
export function idleFeatures(): void {
  for (const feature of FEATURES) feature.idle?.()
}
