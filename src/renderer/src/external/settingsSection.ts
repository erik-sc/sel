// The MCP section of Settings (see shell/settingsSections.ts). Leaf data: the panel is fetched when shown.
import { settingsSection } from '@/shell/sectionSpec'
import { lazyPanel } from '@/ui/lazyPanel'

export const MCP_SECTION = settingsSection({
  id: 'mcp',
  label: 'MCP',
  keywords: ['connect', 'other apps', 'claude desktop', 'claude code', 'token', 'remote', 'phone', 'celular', 'tunnel', 'oauth', 'github'],
  order: 120,
  Section: lazyPanel(() => import('./McpSettings').then((module) => module.McpSection))
})
