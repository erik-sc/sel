// The small part of Herman that is always loaded: whether he is on, and the mood the AI
// requests of this window put him in. Everything with a face is in chunks of its own.
import { create } from 'zustand'
import { hermanSetting, type HermanSkinId } from '@shared/herman'

/** What an AI request does to him: he thinks while it starts, speaks while it streams, and so on. */
export type HermanMood = 'idle' | 'thinking' | 'speaking' | 'pleased' | 'concerned'

interface HermanGate {
  /** `herman.enabled`. False until the setting has loaded: no figure shows before that. */
  on: boolean
  mood: HermanMood
  /** A question he wrote into the conversation for the user to send or change. */
  prepared: string | null
  /** Counts changes to his settings, so that what shows him reads them again. */
  version: number
  /** `herman.skin` and `herman.seasonalSkins`: what Herman 64 wears (see wornSkin). */
  skin: HermanSkinId
  seasonal: boolean
}

export const useHerman = create<HermanGate>(() => ({
  on: false,
  mood: 'idle',
  prepared: null,
  version: 0,
  skin: 'classic',
  seasonal: false
}))

export async function initHerman(): Promise<void> {
  const [value, skin, seasonal] = await Promise.all(
    ['herman.enabled', 'herman.skin', 'herman.seasonalSkins'].map((key) => window.api.app.getSetting<unknown>(key).catch(() => null))
  )
  useHerman.setState({ on: value !== false, skin: hermanSetting('skin', skin), seasonal: hermanSetting('seasonalSkins', seasonal) })
}

/** How long he stays pleased, or concerned, before he settles again. */
const SETTLE_MS = { pleased: 2600, concerned: 5200 } as const
let settle: ReturnType<typeof setTimeout> | undefined

export function setHermanMood(mood: HermanMood): void {
  clearTimeout(settle)
  if (useHerman.getState().mood !== mood) useHerman.setState({ mood })
  if (mood === 'pleased' || mood === 'concerned') settle = setTimeout(() => useHerman.setState({ mood: 'idle' }), SETTLE_MS[mood])
}

/** The mood an event of an AI request leaves him in; null leaves it as it is. */
export function moodAfter(
  event: 'start' | 'started' | 'rejected' | 'delta' | 'done' | 'error' | 'cancel' | 'reset',
  cancelled = false
): HermanMood | null {
  switch (event) {
    case 'start':
      return 'thinking'
    case 'delta':
      return 'speaking'
    case 'done':
      return 'pleased'
    case 'rejected':
      return 'concerned'
    case 'error':
      return cancelled ? 'idle' : 'concerned'
    case 'cancel':
    case 'reset':
      return 'idle'
    default:
      return null
  }
}

/** Called for every event of every AI request of this window (see ai/client.ts). */
export function noteAiEvent(event: Parameters<typeof moodAfter>[0], cancelled = false): void {
  if (!useHerman.getState().on) return
  const mood = moodAfter(event, cancelled)
  if (mood) setHermanMood(mood)
}
