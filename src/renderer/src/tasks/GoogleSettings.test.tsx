// @vitest-environment happy-dom
// Settings → Today → Tasks in Google Calendar: the client first, then the sign-in, then how it went.
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoogleStatus } from '@shared/google'
import { cleanup, fakeApi, render, seriousViolations, settle } from '@/a11y/testing'
import { GoogleSettings } from './GoogleSettings'

const BASE: GoogleStatus = { available: true, clientId: null, signedIn: false, signingIn: false, lastSync: null, events: 0, error: null }
const CLIENT = '123-abc.apps.googleusercontent.com'

function install(status: GoogleStatus): Record<string, ReturnType<typeof vi.fn>> {
  const calls = {
    status: vi.fn(async () => status),
    configure: vi.fn(async (clientId: string) => ({ ...status, clientId })),
    signIn: vi.fn(async () => ({ ...status, signedIn: true, events: 3, lastSync: Date.UTC(2026, 10, 17, 12) })),
    signOut: vi.fn(async () => ({ ...status, signedIn: false })),
    sync: vi.fn(async () => status)
  }
  const base = fakeApi() as Record<string, unknown>
  ;(window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (target, prop) => (prop === 'google' ? calls : target[prop as string])
  })
  return calls
}

const text = (): string => document.body.textContent ?? ''
const button = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label) as HTMLButtonElement
const click = async (el: Element): Promise<void> => {
  await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
  await settle()
}
const field = (label: string): HTMLInputElement =>
  [...document.querySelectorAll('label')]
    .find((each) => each.querySelector('span')?.textContent === label)
    ?.querySelector('input') as HTMLInputElement
async function type(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Tasks in Google Calendar', () => {
  afterEach(cleanup)

  it('asks for the client first, never shows the secret, and only then lets one sign in', async () => {
    const calls = install(BASE)
    await render(<GoogleSettings />)
    await settle()
    expect(button('Sign in with Google').disabled).toBe(true)
    expect(field('Client secret').type).toBe('password')
    expect(button('Save').disabled).toBe(true)
    await type(field('Client ID'), CLIENT)
    await type(field('Client secret'), 'GOCSPX-abcdefgh')
    await act(async () => document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await settle()
    expect(calls.configure).toHaveBeenCalledWith(CLIENT, 'GOCSPX-abcdefgh')
    // Saved: the id is shown, the secret is gone from the page.
    expect(text()).toContain(CLIENT)
    expect(text()).not.toContain('GOCSPX')
    expect(document.querySelector('input[type="password"]')).toBeNull()
    await click(button('Sign in with Google'))
    expect(calls.signIn).toHaveBeenCalled()
    expect(text()).toContain('Signed in to Google')
    expect(text()).toContain('3 tasks in the calendar “sel”')
    expect(await seriousViolations()).toEqual([])
  })

  it('says what went wrong, and sends and signs out when signed in', async () => {
    const calls = install({ ...BASE, clientId: CLIENT, signedIn: true, events: 1, error: 'Google Calendar answered 503.' })
    await render(<GoogleSettings />)
    await settle()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Google Calendar answered 503.')
    await click(button('Send now'))
    expect(calls.sync).toHaveBeenCalled()
    await click(button('Sign out'))
    expect(calls.signOut).toHaveBeenCalled()
    expect(button('Sign in with Google').disabled).toBe(false)
  })

  it('offers nothing where a sign-in cannot be kept safely', async () => {
    install({ ...BASE, available: false })
    await render(<GoogleSettings />)
    await settle()
    expect(text()).toContain('no secure storage')
    expect(button('Sign in with Google')).toBeUndefined()
  })
})
