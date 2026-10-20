import { describe, expect, it } from 'vitest'
import { HOME_SCREENS } from '@shared/home'
import { NOTEBOOK_ID } from '@shared/notebook'
import { SKY_ID } from '@shared/sky'
import * as ROUTES from './routes'
import { routeTitle, SCREENS, screenOf } from './screens'

describe('the screens', () => {
  it('give every route one screen, and no block id', () => {
    const routes = SCREENS.map((screen) => screen.route)
    expect([...routes].sort()).toEqual(Object.values(ROUTES).sort())
    for (const route of routes) expect(route.startsWith('_'), route).toBe(true)
  })

  it('name each screen on its tab, also when a tab holds the page a screen stands for', () => {
    expect(routeTitle(ROUTES.TODAY_ROUTE)).toBe('Today')
    expect(routeTitle(ROUTES.CALENDAR_ROUTE)).toBe('Calendar')
    expect(routeTitle(ROUTES.TASKS_ROUTE)).toBe('Tasks')
    expect(routeTitle(ROUTES.NOTEBOOK_ROUTE)).toBe('Meditations')
    expect(routeTitle(NOTEBOOK_ID)).toBe('Meditations')
    expect(routeTitle(ROUTES.CLOSE_ROUTE)).toBe('Close the day')
    expect(routeTitle(ROUTES.SKY_ROUTE)).toBe('Sky')
    expect(routeTitle(SKY_ID)).toBe('Sky')
    for (const notOne of ['a1b2c3', '', null, undefined]) expect(routeTitle(notOne)).toBeNull()
    expect(screenOf(SKY_ID)?.route).toBe(ROUTES.SKY_ROUTE)
  })

  it('can be the home only by a route that exists', () => {
    for (const route of HOME_SCREENS) expect(screenOf(route)?.route).toBe(route)
  })
})
