import { createContext, useContext } from 'react'
import type { ThemePreference } from './theme'

export const ThemeContext = createContext<{
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
  storageAvailable: boolean
} | null>(null)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('ThemeProvider is required')
  return context
}
