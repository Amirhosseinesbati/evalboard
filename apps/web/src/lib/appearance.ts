export const accents = {
  ocean: { label: 'Ocean', color: '#007f91', bright: '#08a9bc' },
  forest: { label: 'Forest', color: '#18745e', bright: '#40b990' },
  iris: { label: 'Iris', color: '#6850a6', bright: '#aa8ce7' },
} as const

export interface Appearance {
  name: string
  tagline: string
  accent: keyof typeof accents
  density: 'comfortable' | 'compact'
  collapsed: boolean
}

const envAccent = import.meta.env.VITE_BRAND_ACCENT as string | undefined
export const defaultAppearance: Appearance = {
  name: (import.meta.env.VITE_BRAND_NAME?.trim() || 'EvalBoard').slice(0, 40),
  tagline: (import.meta.env.VITE_BRAND_TAGLINE?.trim() || 'Evidence before release.').slice(0, 100),
  accent: envAccent && Object.hasOwn(accents, envAccent) ? envAccent as Appearance['accent'] : 'ocean',
  density: 'comfortable',
  collapsed: false,
}

export const appearanceKey = 'evalboard.appearance.v1'

export function parseAppearance(value: unknown): Appearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Appearance must be a JSON object.')
  const object = value as Record<string, unknown>
  if (object.version !== 1) throw new Error('Use an EvalBoard appearance file with version 1.')
  const settings = object.appearance as Record<string, unknown> | undefined
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('The appearance settings are missing.')
  if (typeof settings.name !== 'string' || !settings.name.trim() || settings.name.trim().length > 40) throw new Error('Product name must contain 1–40 characters.')
  if (typeof settings.tagline !== 'string' || settings.tagline.length > 100) throw new Error('Tagline must contain at most 100 characters.')
  if (typeof settings.accent !== 'string' || !Object.hasOwn(accents, settings.accent)) throw new Error('Choose ocean, forest, or iris as the accent.')
  if (settings.density !== 'comfortable' && settings.density !== 'compact') throw new Error('Density must be comfortable or compact.')
  if (typeof settings.collapsed !== 'boolean') throw new Error('Sidebar preference must be true or false.')
  return { name: settings.name.trim(), tagline: settings.tagline.trim(), accent: settings.accent as Appearance['accent'], density: settings.density, collapsed: settings.collapsed }
}

export function readAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(appearanceKey)
    return stored ? parseAppearance(JSON.parse(stored)) : defaultAppearance
  } catch { return defaultAppearance }
}

export function serializeAppearance(appearance: Appearance) {
  return JSON.stringify({ version: 1, appearance }, null, 2)
}
