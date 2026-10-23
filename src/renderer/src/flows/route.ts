// The way to the Fluxos screen (D2–D4 of docs/plans/release-0.8.0.md): from the palette, the
// menu, Today and a word about the rhythm. Always loaded; the screen itself is a chunk of its own
// (screens.ts, Host.tsx).
import { FLOWS_ROUTE } from '@/routes'
import { openScreen } from '@/store/tabs'

export function openFlows(): void {
  openScreen(FLOWS_ROUTE)
}
