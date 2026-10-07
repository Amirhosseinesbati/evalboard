import { useLayoutEffect, useState, type ReactNode } from 'react'
import { appearanceKey, readAppearance, serializeAppearance, type Appearance } from '../lib/appearance'
import { AppearanceContext } from '../lib/useAppearance'

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(readAppearance)
  const [storageAvailable, setStorageAvailable] = useState(true)
  const saveAppearance = (next: Appearance) => {
    setAppearance(next)
    try { localStorage.setItem(appearanceKey, serializeAppearance(next)); setStorageAvailable(true) }
    catch { setStorageAvailable(false) }
  }
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.accent = appearance.accent
    root.dataset.density = appearance.density
    document.title = `${appearance.name} · Evaluation workbench`
  }, [appearance])
  return <AppearanceContext.Provider value={{ appearance, saveAppearance, storageAvailable }}>{children}</AppearanceContext.Provider>
}
