// The way to the Skills screen: from the sidebar, the palette and the menu. Always loaded; the
// screen itself is a chunk of its own (screens.ts, Host.tsx).
import { SKILLS_ROUTE } from '@/routes'
import { openScreen } from '@/store/tabs'

export function openSkills(): void {
  openScreen(SKILLS_ROUTE)
}
