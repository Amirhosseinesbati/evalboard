export type ThemePreference = 'light' | 'dark' | 'system'
export const themeKey = 'evalboard.theme.v1'
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}
export function readTheme() {
  try {
    const saved = localStorage.getItem(themeKey)
    return { preference: isThemePreference(saved) ? saved : 'dark' as ThemePreference, storageAvailable: true }
  } catch {
    return { preference: 'dark' as ThemePreference, storageAvailable: false }
  }
}
