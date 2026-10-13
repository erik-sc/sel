/**
 * Startup timeline, off unless `--sel-trace-startup` is on the command line
 * or `SEL_TRACE_STARTUP=1` is in the environment. Times are milliseconds
 * since the OS created the process, so they include Electron's own boot.
 *
 * The flag is deliberately not called `--trace-startup`: that is a Chromium
 * switch, and passing it makes Chromium record its own startup trace (an extra
 * tracing process and a slower launch), which would distort what is measured.
 */
const enabled = process.argv.includes('--sel-trace-startup') || process.env['SEL_TRACE_STARTUP'] === '1'

// `getCreationTime` is Electron-only (absent under vitest); fall back to the JS time origin.
const created = enabled ? ((process as { getCreationTime?: () => number | null }).getCreationTime?.() ?? null) : null
const origin = created ?? performance.timeOrigin
const marks: [label: string, at: number][] = enabled ? [['process start', 0]] : []

/** Records one point of the timeline. A no-op (one boolean test) when tracing is off. */
export function mark(label: string): void {
  if (enabled) marks.push([label, performance.timeOrigin + performance.now() - origin])
}

/** Prints the timeline collected so far to stdout and forgets it. */
export function flushTrace(): void {
  if (!enabled || !marks.length) return
  const lines = marks.map(([label, at]) => `[startup] ${at.toFixed(1).padStart(8)} ms  ${label}`)
  marks.length = 0
  process.stdout.write(lines.join('\n') + '\n')
}
