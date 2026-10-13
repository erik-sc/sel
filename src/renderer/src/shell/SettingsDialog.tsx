// The settings window itself. Loaded on demand through SettingsModal.tsx.
import { useState } from 'react'
import type { Theme } from '@shared/types'
import { AppearancePanel } from '@/appearance/AppearancePanel'
import '@/appearance/appearance.css'
import { Segmented } from '@/appearance/controls'
import { setSettingsOpen, setTheme, useUi } from '@/store/ui'
import { Button, IconButton } from '@/ui/Button'
import { Modal } from '@/ui/Modal'
import { Close } from '@/ui/icons'
import { HistorySection } from '@/versions/HistorySettings'
import { importMarkdown } from './actions'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

type Section = 'general' | 'appearance' | 'history'

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'history', label: 'History' }
]

export function SettingsDialog() {
  const open = useUi((state) => state.settingsOpen)
  return (
    <Modal open={open} onClose={() => setSettingsOpen(false)} label="Settings" className="settings2">
      <SettingsBody />
    </Modal>
  )
}

function SettingsBody() {
  const [section, setSection] = useState<Section>('general')
  const title = SECTIONS.find((entry) => entry.value === section)?.label

  return (
    <>
      <nav className="settings2-nav" aria-label="Settings sections">
        <h2 className="settings2-nav-title">Settings</h2>
        {SECTIONS.map((entry) => (
          <button
            type="button"
            key={entry.value}
            className={entry.value === section ? 'settings2-nav-item is-selected' : 'settings2-nav-item'}
            aria-current={entry.value === section ? 'page' : undefined}
            onClick={() => setSection(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </nav>
      <div className="settings2-main">
        <header className="settings2-header">
          <h2>{title}</h2>
          <IconButton label="Close" tooltip={false} onClick={() => setSettingsOpen(false)}>
            <Close />
          </IconButton>
        </header>
        <div className="settings2-content">
          {section === 'general' ? <GeneralSection /> : section === 'history' ? <HistorySection /> : <AppearancePanel />}
        </div>
      </div>
    </>
  )
}

function GeneralSection() {
  const theme = useUi((state) => state.theme)
  const [importState, setImportState] = useState<'idle' | 'busy' | 'failed'>('idle')

  const runImport = (): void => {
    setImportState('busy')
    importMarkdown(null)
      .then((page) => {
        setImportState('idle')
        if (page) setSettingsOpen(false)
      })
      .catch((error) => {
        console.error('import failed', error)
        setImportState('failed')
      })
  }

  return (
    <div className="settings2-scroll">
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Theme</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Theme</span>
              <span className="ap-row-help">System follows your operating system setting.</span>
            </div>
            <div className="ap-row-control">
              <Segmented label="Theme" value={theme} options={THEMES} onChange={(value) => setTheme(value)} />
            </div>
          </div>
        </div>
        <p className="ap-note">Colours, glass, fonts and spacing are under Appearance.</p>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Data</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Import Markdown</span>
              <span className={importState === 'failed' ? 'ap-row-help is-error' : 'ap-row-help'}>
                {importState === 'failed' ? 'The file could not be imported.' : 'Create a new page from a .md file.'}
              </span>
            </div>
            <div className="ap-row-control">
              <Button disabled={importState === 'busy'} onClick={runImport}>
                {importState === 'busy' ? 'Importing…' : 'Choose file…'}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">About</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Selida</span>
              <span className="ap-row-help">
                A local-first workspace for notes and databases. Everything you write is stored on this device.
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
