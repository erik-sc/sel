// The Notifications section of Settings (see shell/settingsSections.ts). Leaf data: the panel is fetched when shown.
import { settingsSection } from '@/shell/sectionSpec'
import { lazyPanel } from '@/ui/lazyPanel'

export const NOTIFICATIONS_SECTION = settingsSection({
  id: 'notifications',
  label: 'Notifications',
  keywords: ['notificações', 'reminders', 'lembretes', 'alarms', 'events', 'tray', 'bandeja'],
  order: 70,
  Section: lazyPanel(() => import('./NotificationSettings').then((module) => module.NotificationsSection))
})
