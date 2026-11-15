import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, getThemePreference, setThemePreference, resolveTheme } from './theme'

let systemDark = false
const listeners: ((e: { matches: boolean }) => void)[] = []
beforeEach(() => {
  localStorage.clear()
  listeners.length = 0
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('dark') ? systemDark : false,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
    removeEventListener: vi.fn(),
  }))
})
afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.theme })

describe('tema', () => {
  it('defaults to automatic (follows the system)', () => {
    expect(getThemePreference()).toBe('system')
    systemDark = true
    expect(resolveTheme('system')).toBe('dark')
    systemDark = false
    expect(resolveTheme('system')).toBe('light')
  })

  it('a chosen theme wins over the system and is remembered', () => {
    systemDark = true
    setThemePreference('light')
    expect(getThemePreference()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('automatic follows the system when it changes', () => {
    systemDark = false
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('light')
    systemDark = true
    listeners.forEach((fn) => fn({ matches: true }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
