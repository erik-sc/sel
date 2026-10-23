// What each persona can wear, and choosing it: shared by Settings → Herman and the persona's
// introduction (ai/Onboarding.tsx), which both show the outfits as buttons with their pictures.
import type { JSX } from 'react'
import {
  HERMAN_SEASONAL_SKINS,
  HERMAN_SKINS,
  HERMINE_SEASONAL_SKINS,
  HERMINE_SKINS,
  PERSONA_NAMES,
  PERSONAS,
  type HermanSettings,
  type HermanSkinId,
  type HermineSkinId,
  type PersonaId
} from '@shared/herman'
import { useHerman } from './gate'
import { spriteUrl } from './sprites'

export const PERSONA_OPTIONS = PERSONAS.map((value) => ({ value, label: PERSONA_NAMES[value] }))

const SKIN_LABELS: Record<HermanSkinId, string> = {
  classic: 'Classic',
  wizard: 'Star wizard',
  monk: 'Zen monk',
  hacker: 'Hacker',
  gardener: 'Gardener',
  astronaut: 'Astronaut',
  pirate: 'Pirate',
  detective: 'Detective',
  scribe: 'Scribe',
  stone: 'Stone',
  santa: 'Santa',
  pumpkin: 'Pumpkin'
}
const HERMINE_SKIN_LABELS: Record<HermineSkinId, string> = {
  classic: 'Classic',
  astronomer: 'Astronomer',
  gardener: 'Gardener',
  hacker: 'Hacker',
  monk: 'Zen monk',
  aviator: 'Aviator',
  painter: 'Painter',
  librarian: 'Librarian',
  captain: 'Captain',
  astronaut: 'Astronaut',
  witch: 'Witch',
  winter: 'Winter'
}

/** Each persona's wardrobe: the everyday skins, those of a season (with their month), and their names. */
export const WARDROBES: Record<
  PersonaId,
  { skins: readonly string[]; seasons: Partial<Record<string, number>>; labels: Record<string, string> }
> = {
  herman: { skins: HERMAN_SKINS, seasons: HERMAN_SEASONAL_SKINS, labels: SKIN_LABELS },
  hermine: { skins: HERMINE_SKINS, seasons: HERMINE_SEASONAL_SKINS, labels: HERMINE_SKIN_LABELS }
}

/** The outfits worn every day (not those of a season). */
export function everydaySkins(persona: PersonaId): string[] {
  const wardrobe = WARDROBES[persona]
  return wardrobe.skins.filter((skin) => wardrobe.seasons[skin] === undefined)
}

/**
 * Stores one of the persona's settings and tells what shows the persona (the corner, the pictures)
 * at once, so a change is seen without a restart. Rejects when it could not be stored.
 */
export async function saveHermanSetting<K extends keyof HermanSettings>(name: K, value: HermanSettings[K]): Promise<void> {
  await window.api.app.setSetting(`herman.${name}`, value)
  useHerman.setState((state) => ({
    version: state.version + 1,
    ...(name === 'enabled' ? { on: value === true } : {}),
    ...(name === 'skin' ? { skin: value as HermanSkinId } : {}),
    ...(name === 'hermineSkin' ? { hermineSkin: value as HermineSkinId } : {}),
    ...(name === 'persona' ? { persona: value as PersonaId } : {}),
    ...(name === 'seasonalSkins' ? { seasonal: value === true } : {})
  }))
}

export function SkinChoice({
  persona,
  skin,
  label,
  chosen,
  note,
  onChoose
}: {
  persona: PersonaId
  skin: string
  label: string
  chosen: boolean
  note?: string
  onChoose: () => void
}): JSX.Element {
  return (
    <button type="button" className={chosen ? 'herman-skin is-chosen' : 'herman-skin'} aria-pressed={chosen} onClick={onChoose}>
      <img src={spriteUrl(skin as HermanSkinId | HermineSkinId, 'still', persona)} alt="" width={84} height={84} />
      <span className="herman-skin-name">{label}</span>
      {note && <span className="herman-skin-note">{note}</span>}
    </button>
  )
}
