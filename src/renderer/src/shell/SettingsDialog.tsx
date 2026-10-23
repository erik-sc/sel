// The settings window itself. Loaded on demand through SettingsModal.tsx.
import { Suspense, useEffect, useState } from 'react'
import '@/appearance/appearance.css'
import { takeSettingsSection } from '@/briefing/route'
import { setSettingsOpen, useUi } from '@/store/ui'
import { IconButton } from '@/ui/Button'
import { Close } from '@/ui/icons'
import { Modal } from '@/ui/Modal'
import { personaTitle, useHerman } from '@/herman/gate'
import { SETTINGS_SECTIONS, type SettingsSection } from './settingsSections'

/** One Settings window per app window: its title names the dialog. */
const SETTINGS_TITLE = 'settings-title'

export function SettingsDialog() {
  const open = useUi((state) => state.settingsOpen)
  return (
    <Modal open={open} onClose={() => setSettingsOpen(false)} labelledBy={SETTINGS_TITLE} className="settings2">
      <SettingsBody />
    </Modal>
  )
}

function SettingsBody() {
  const requested = useUi((state) => state.settingsSection)
  const [section, setSection] = useState<SettingsSection>(() => requested ?? takeSettingsSection() ?? 'general')
  const shown = SETTINGS_SECTIONS.find((entry) => entry.id === section) ?? SETTINGS_SECTIONS[0]
  // The section `herman` is named after the chosen persona: "Herman" or "Hermine".
  useHerman((state) => state.persona)

  // Something outside asked for a section (the sync indicator): show it, once.
  useEffect(() => {
    if (requested === null) return
    setSection(requested)
    useUi.setState({ settingsSection: null })
  }, [requested])

  return (
    <>
      <nav className="settings2-nav" aria-label="Settings sections">
        <h2 className="settings2-nav-title" id={SETTINGS_TITLE}>
          Settings
        </h2>
        {SETTINGS_SECTIONS.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className={entry.id === section ? 'settings2-nav-item is-selected' : 'settings2-nav-item'}
            aria-current={entry.id === section ? 'page' : undefined}
            onClick={() => setSection(entry.id)}
          >
            {personaTitle(entry.label)}
          </button>
        ))}
      </nav>
      <div className="settings2-main">
        <header className="settings2-header">
          <h2>{personaTitle(shown.label)}</h2>
          <IconButton label="Close" tooltip={false} onClick={() => setSettingsOpen(false)}>
            <Close />
          </IconButton>
        </header>
        <div className="settings2-content">
          {/* Each section is fetched the first time it is shown (./settingsSections.ts). */}
          <Suspense fallback={<div className="settings2-scroll" aria-busy="true" />}>
            <shown.Section />
          </Suspense>
        </div>
      </div>
    </>
  )
}
