// The way to the Finance screen: from the sidebar, the palette and the menu. Always loaded; the
// screen itself is a chunk of its own (screens.ts, Host.tsx).
import { FINANCE_ROUTE } from '@/routes'
import { openScreen } from '@/store/tabs'

export function openFinance(): void {
  openScreen(FINANCE_ROUTE)
}
