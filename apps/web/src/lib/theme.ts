// Light / dark / automatic (follows the operating system). The choice is per browser; the resolved
// theme is set on <html data-theme> (index.html does it before the app loads, so nothing flashes).
export type ThemePreference = 'light' | 'dark' | 'system'

const KEY = 'theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

let stopFollowingSystem: (() => void) | null = null

export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement
  const set = () => {
    const theme = resolveTheme(pref)
    root.dataset.theme = theme
    root.style.colorScheme = theme
  }
  set()
  stopFollowingSystem?.()
  stopFollowingSystem = null
  if (pref === 'system' && typeof matchMedia === 'function') {
    const mq = matchMedia(DARK_QUERY)
    mq.addEventListener('change', set)
    stopFollowingSystem = () => mq.removeEventListener('change', set)
  }
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch { /* storage blocked: still applies for this session */ }
  applyTheme(pref)
}
