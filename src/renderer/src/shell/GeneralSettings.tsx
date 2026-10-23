// The General section of Settings: the theme, pages, data, updates and what sel is.
import { useState } from 'react'
import type { Theme } from '@shared/types'
import { ActivitySettingsRows } from '@/activity/ActivitySettings'
import { Segmented } from '@/appearance/controls'
import { DataSettingsRows } from '@/backup/DataSettings'
import { HomeSettingsRows } from '@/home/HomeSettings'
import { setSettingsOpen, setTheme, setWordCount, useUi } from '@/store/ui'
import { Button } from '@/ui/Button'
import { UpdatesGroup } from '@/updates/UpdatesSettings'
import { importMarkdown } from './actions'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

export function GeneralSection() {
  const theme = useUi((state) => state.theme)
  const wordCount = useUi((state) => state.wordCount)
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
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Pages</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Word count</span>
              <span className="ap-row-help">Words and reading time of the page, in the top bar.</span>
            </div>
            <div className="ap-row-control">
              <Segmented
                label="Word count"
                value={wordCount ? 'on' : 'off'}
                options={ON_OFF}
                onChange={(value) => setWordCount(value === 'on')}
              />
            </div>
          </div>
          <HomeSettingsRows />
        </div>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Data</h3>
        </div>
        <div className="ap-list">
          <DataSettingsRows />
          <ActivitySettingsRows />
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

      <UpdatesGroup />

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">About</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">sel</span>
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
