import { Monitor, Moon, Sun } from 'lucide-react'
import { isThemePreference } from '../lib/theme'
import { useTheme } from '../lib/useTheme'

export function ThemeControl() {
  const { preference, setPreference, storageAvailable } = useTheme()
  const Icon = preference === 'system' ? Monitor : preference === 'dark' ? Moon : Sun
  return <div className="theme-control-wrap">
    <label className="theme-control"><Icon size={15} aria-hidden="true" /><span className="sr-only">Theme</span>
      <select value={preference} onChange={event => { if (isThemePreference(event.target.value)) setPreference(event.target.value) }}>
        <option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option>
      </select>
    </label>
    {!storageAvailable && <span className="theme-storage-note" role="status">Theme applies for this session. Browser storage is unavailable.</span>}
  </div>
}
