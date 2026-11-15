// @vitest-environment happy-dom
// The closed part of a section of Settings: there, but not open until asked for.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@/a11y/testing'
import { Advanced, SettingsGroup } from './Advanced'

describe('Advanced', () => {
  afterEach(cleanup)

  it('is closed until asked for, with everything still in it', async () => {
    await render(
      <Advanced>
        <SettingsGroup title="Storage" note="Kept on this device.">
          <div className="ap-row">Space for all history</div>
        </SettingsGroup>
      </Advanced>
    )
    const details = document.querySelector('details.ui-advanced') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('Advanced')
    expect(details.textContent).toContain('Space for all history')
    expect(details.querySelector('.ap-group-title')?.textContent).toBe('Storage')
  })

  it('opens by itself when something in it needs attention, under the word it is given', async () => {
    await render(
      <Advanced open label="Avançado">
        <p>Claude Code was not found.</p>
      </Advanced>
    )
    const details = document.querySelector('details.ui-advanced') as HTMLDetailsElement
    expect(details.open).toBe(true)
    expect(details.querySelector('summary')?.textContent).toBe('Avançado')
  })
})
