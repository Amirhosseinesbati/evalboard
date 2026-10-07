import { createContext, useContext } from 'react'
import type { Appearance } from './appearance'

export const AppearanceContext = createContext<{
  appearance: Appearance
  saveAppearance: (next: Appearance) => void
  storageAvailable: boolean
} | null>(null)

export function useAppearance() {
  const context = useContext(AppearanceContext)
  if (!context) throw new Error('AppearanceProvider is required')
  return context
}
