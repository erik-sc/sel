// The chime and the voice of an announcement. The chime is synthesised here (no sound file, so
// nothing to fetch and nothing for the content policy to allow); the voice is the system's own
// speech synthesis, which on Windows runs on this computer.
import type { Announcement } from '@shared/alarms'
import { setHermanMood } from '@/herman/gate'

let context: AudioContext | null = null
let speaking: SpeechSynthesisUtterance | null = null

/** Three soft notes, rising: about a second and a half. */
export async function chime(): Promise<void> {
  context ??= new AudioContext()
  if (context.state === 'suspended') await context.resume().catch(() => undefined)
  const start = context.currentTime + 0.05
  const notes = [659.25, 880, 1174.66]
  notes.forEach((frequency, index) => {
    const at = start + index * 0.28
    for (const [ratio, level] of [
      [1, 0.16],
      [2, 0.03]
    ] as const) {
      const oscillator = context!.createOscillator()
      const gain = context!.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency * ratio
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(level, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1)
      oscillator.connect(gain).connect(context!.destination)
      oscillator.start(at)
      oscillator.stop(at + 1.15)
    }
  })
  await new Promise((resolve) => setTimeout(resolve, 1300))
}

/** The voices of this system, once it has listed them (the list may come a moment after start). */
export function voices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis
  if (!synth) return Promise.resolve([])
  const now = synth.getVoices()
  if (now.length) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = (): void => {
      synth.removeEventListener('voiceschanged', done)
      resolve(synth.getVoices())
    }
    synth.addEventListener('voiceschanged', done)
    setTimeout(done, 1500)
  })
}

/** The voice to speak `locale` with: the one chosen by name, else the first of that language. */
export function pickVoice(list: readonly SpeechSynthesisVoice[], locale: string, name: string | null): SpeechSynthesisVoice | null {
  if (name) {
    const chosen = list.find((voice) => voice.name === name)
    if (chosen) return chosen
  }
  const lang = locale.toLowerCase()
  return (
    list.find((voice) => voice.lang.toLowerCase() === lang) ??
    list.find((voice) => voice.lang.toLowerCase().startsWith(lang.slice(0, 2))) ??
    null
  )
}

/** Reads `text` aloud; resolves when done (or at once when there is no speech synthesis). */
export async function speak(text: string, locale: string, name: string | null): Promise<void> {
  const synth = window.speechSynthesis
  if (!synth || !text.trim()) return
  hush()
  const voice = pickVoice(await voices(), locale, name)
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = voice?.lang ?? locale
  if (voice) utterance.voice = voice
  utterance.rate = 1
  speaking = utterance
  setHermanMood('speaking')
  await new Promise<void>((resolve) => {
    const end = (): void => {
      if (speaking === utterance) {
        speaking = null
        setHermanMood('idle')
      }
      resolve()
    }
    utterance.onend = end
    utterance.onerror = end
    synth.speak(utterance)
  })
}

/** Stops speaking at once. */
export function hush(): void {
  if (speaking) {
    speaking = null
    setHermanMood('idle')
  }
  window.speechSynthesis?.cancel()
}

export async function play(announcement: Announcement): Promise<void> {
  if (announcement.sound) await chime().catch((error: unknown) => console.error('the chime could not be played', error))
  if (announcement.voice) await speak(announcement.speech, announcement.locale, announcement.voiceName)
}
