// The way to the household screen ("Divisão de contas"): from the sidebar, the palette and the
// menu. Always loaded; the screen itself is a chunk of its own (screens.ts, Host.tsx).
import { SPLIT_ROUTE } from '@/routes'
import { openScreen } from '@/store/tabs'

export function openSplit(): void {
  openScreen(SPLIT_ROUTE)
}
