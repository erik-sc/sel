// The soft bell that closes the day, made on the spot with Web Audio: a few sine partials in the
// ratios of a small bowl, each fading on its own. Nothing is loaded: the content security policy
// has no media source for bundled sounds, and none is needed.

/** The partials of the bell: frequency ratio, loudness, and how long it rings (seconds). */
const PARTIALS: readonly (readonly [number, number, number])[] = [
  [1, 1, 6.5],
  [2.756, 0.42, 4.2],
  [5.404, 0.2, 2.6],
  [8.933, 0.08, 1.6]
]
const FUNDAMENTAL = 293.66 // D4: low enough to be calm, high enough for laptop speakers.
const VOLUME = 0.14

/** Rings once. Fails silently where there is no audio. */
export function ringBell(): void {
  let context: AudioContext
  try {
    context = new AudioContext()
  } catch {
    return
  }
  const start = context.currentTime + 0.05
  const master = context.createGain()
  master.gain.value = VOLUME
  master.connect(context.destination)
  let longest = 0
  for (const [ratio, level, seconds] of PARTIALS) {
    const oscillator = context.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.value = FUNDAMENTAL * ratio
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, start)
    // A soft strike, then a long exponential fade.
    gain.gain.exponentialRampToValueAtTime(level, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds)
    oscillator.connect(gain).connect(master)
    oscillator.start(start)
    oscillator.stop(start + seconds + 0.1)
    longest = Math.max(longest, seconds)
  }
  setTimeout(() => void context.close().catch(() => undefined), (longest + 0.5) * 1000)
}
