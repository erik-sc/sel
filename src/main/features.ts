import { activityFeature } from './activity/register'
import { aiFeature } from './ai/register'
import { alarmsFeature } from './alarms/register'
import { briefingFeature } from './briefing/register'
import { dataFeature } from './data/register'
import { transferFeature } from './transfer/register'
import { mcpFeature } from './external/register'
import { feedbackFeature } from './feedback/register'
import { hermanFeature } from './herman/register'
import { meetingsFeature } from './meetings/register'
import { notebookFeature } from './notebook/register'
import { pomodoroFeature } from './pomodoro/register'
import { routinesFeature } from './routines/register'
import { skyFeature } from './sky/register'
import { syncFeature } from './sync/register'
import { tasksFeature } from './tasks/register'
import { templatesFeature } from './templates/register'
import { updatesFeature } from './updates/register'

/**
 * Every feature's main side, the one list of them: ./ipc.ts registers each with the same context
 * (./feature.ts), in this order, and answers its channels with what it returns. A feature adds
 * itself here, one line. Order matters only to a feature that uses another while registering
 * (the Sky listens to the pomodoro): that one comes after.
 */
export const FEATURES = [
  aiFeature,
  syncFeature,
  briefingFeature,
  meetingsFeature,
  hermanFeature,
  notebookFeature,
  alarmsFeature,
  pomodoroFeature,
  skyFeature,
  templatesFeature,
  dataFeature,
  transferFeature,
  feedbackFeature,
  tasksFeature,
  updatesFeature,
  mcpFeature,
  activityFeature,
  routinesFeature
] as const

/** The namespace of a feature in the list. */
export type FeatureName = (typeof FEATURES)[number]['namespace']

/** What a feature's `register` returned, by its namespace. */
export type RegisteredOf<N extends FeatureName> = ReturnType<Extract<(typeof FEATURES)[number], { namespace: N }>['register']>
