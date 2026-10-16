// The sound at the end of a pomodoro phase: two soft notes, synthesised here like the alarms'
// chime (alarms/play.ts) and the bell of Close the day, so there is no file to fetch and nothing
// for the content policy to allow. Falling into a break, rising back to focus.

let context: AudioContext | null = null

/** About a second: `rest` falls (a break begins), `focus` rises (back to work). */
export async function bell(kind: 'rest' | 'focus'): Promise<void> {
  context ??= new AudioContext()
  if (context.state === 'suspended') await context.resume().catch(() => undefined)
  const ctx = context
  const start = ctx.currentTime + 0.05
  const notes = kind === 'rest' ? [783.99, 587.33] : [587.33, 783.99]
  notes.forEach((frequency, index) => {
    const at = start + index * 0.22
    for (const [ratio, level] of [[1, 0.14], [3, 0.012]] as const) {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency * ratio
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(level, at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.8)
      oscillator.connect(gain).connect(ctx.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.85)
    }
  })
  await new Promise((resolve) => setTimeout(resolve, 1100))
}
