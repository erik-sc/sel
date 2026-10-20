// Every feature of a window, the one list of them: each declares itself in its own folder
// (`<feature>/feature.ts`, see ./feature.ts). A feature adds itself here, one line.
import { aiFeature } from './ai/feature'
import { briefingFeature } from './briefing/feature'
import { feedbackFeature } from './feedback/feature'
import { homeFeature } from './home/feature'
import { meetingsFeature } from './meetings/feature'
import { notebookFeature } from './notebook/feature'
import { pomodoroFeature } from './pomodoro/feature'
import { shellFeature } from './shell/feature'
import { skyFeature } from './sky/feature'
import { tasksFeature } from './tasks/feature'
import { templatesFeature } from './templates/feature'

export const FEATURES = [
  shellFeature,
  templatesFeature,
  homeFeature,
  briefingFeature,
  tasksFeature,
  notebookFeature,
  skyFeature,
  pomodoroFeature,
  meetingsFeature,
  aiFeature,
  feedbackFeature
] as const
