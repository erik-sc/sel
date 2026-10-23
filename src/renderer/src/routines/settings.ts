// Reading and writing the routines setting (`ai.routines`, shared/routines.ts). The onboarding (A1)
// turns routines on through `enableRoutines`; Settings → AI → Routines edits each one.
import { readRoutines, ROUTINES_KEY, withRoutines, type RoutineId, type RoutinesSettings } from '@shared/routines'

export async function loadRoutineSettings(): Promise<RoutinesSettings> {
  return readRoutines(await window.api.app.getSetting<unknown>(ROUTINES_KEY))
}

export async function saveRoutineSettings(settings: RoutinesSettings): Promise<void> {
  await window.api.app.setSetting(ROUTINES_KEY, settings)
}

/**
 * Turns some routines on (or off), keeping their times and the rest as they are. For the
 * onboarding: `enableRoutines(['morning', 'evening'])`. Resolves with what was stored.
 */
export async function enableRoutines(ids: readonly RoutineId[], on = true): Promise<RoutinesSettings> {
  const next = withRoutines(await loadRoutineSettings(), ids, on)
  await saveRoutineSettings(next)
  return next
}
