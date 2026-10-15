/**
 * Which windows may speak. The small quick-add window (the renderer at `?quickadd=1`, see
 * src/main/tasks/window.ts) starts nothing of the workspace, so it has neither Herman nor a voice:
 * an announcement sent there would be lost.
 *
 * Pure: it is handed addresses. Unit-tested.
 */

/** True for the address of the quick-add window. */
export function isQuickAddUrl(address: string): boolean {
  try {
    return new URL(address).searchParams.get('quickadd') === '1'
  } catch {
    return false
  }
}
