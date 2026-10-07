import { useLayoutEffect, useState, type ReactNode } from 'react'
import { readTheme, themeKey, type ThemePreference } from '../lib/theme'
import { ThemeContext } from '../lib/useTheme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(readTheme)
  const setPreference = (preference: ThemePreference) => {
    let storageAvailable = true
    try { localStorage.setItem(themeKey, preference) } catch { storageAvailable = false }
    setTheme({ preference, storageAvailable })
  }
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = theme.preference === 'system' ? media.matches ? 'dark' : 'light' : theme.preference
      document.documentElement.dataset.theme = resolved
      document.documentElement.dataset.themePreference = theme.preference
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0b1018' : '#f3f5f8')
    }
    apply()
    if (theme.preference !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme.preference])
  return <ThemeContext.Provider value={{ ...theme, setPreference }}>{children}</ThemeContext.Provider>
}
