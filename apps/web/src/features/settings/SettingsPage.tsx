import { useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Activity, Check, Download, Palette, RotateCcw, Upload } from 'lucide-react'
import { Field, PageHeader, SectionTitle } from '../../components/Primitives'
import { accents, defaultAppearance, parseAppearance, serializeAppearance, type Appearance } from '../../lib/appearance'
import { useAppearance } from '../../lib/useAppearance'
import { ThemeControl } from '../../components/ThemeControl'

export function SettingsPage() {
  const { appearance, saveAppearance, storageAvailable } = useAppearance()
  const [draft, setDraft] = useState<Appearance>(appearance)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [transferMessage, setTransferMessage] = useState('')
  const [transferError, setTransferError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const update = <K extends keyof Appearance>(key: K, value: Appearance[K]) => { setDraft(current => ({ ...current, [key]: value })); setMessage(''); setError(''); setTransferMessage(''); setTransferError('') }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    try { const next = parseAppearance({ version: 1, appearance: draft }); saveAppearance(next); setDraft(next); setMessage('Appearance applied.'); setError(''); setTransferMessage(''); setTransferError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to apply appearance.') }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([serializeAppearance(appearance)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'evalboard-appearance.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setTransferMessage('Applied appearance exported.'); setTransferError('')
  }
  const importFile = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 16_000) throw new Error('Appearance files must be smaller than 16 KB.')
      const next = parseAppearance(JSON.parse(await file.text()))
      setDraft(next); setTransferMessage('File loaded into preview. Apply appearance to save it.'); setTransferError(''); setMessage(''); setError('')
    } catch (cause) { setTransferError(cause instanceof SyntaxError ? 'This file is not valid JSON.' : cause instanceof Error ? cause.message : 'Unable to read this file.'); setTransferMessage('') }
    finally { if (input.current) input.current.value = '' }
  }
  const dirty = serializeAppearance(draft) !== serializeAppearance(appearance)
  return <div className="stack-page"><PageHeader eyebrow="MAKE IT YOURS" title="Appearance" description="Adapt the workbench to a client brand and the way you work." />
    <section className="panel theme-settings"><div><h2>Workbench theme</h2><p>Light, dark, or your system preference. Changes apply immediately and preserve your work. System follows device changes; new browsers start in Dark.</p></div><ThemeControl /></section>
    <div className="settings-layout"><form className="panel appearance-form" onSubmit={submit}>
      <SectionTitle title="Identity & display" caption="These preferences apply in this browser. Export them to reuse on another installation." />
      <div className="form-grid"><Field label="Product name" required hint="Up to 40 characters"><input value={draft.name} maxLength={40} required onChange={event => update('name', event.target.value)} /></Field><Field label="Tagline" hint="Shown on your workspace overview"><input value={draft.tagline} maxLength={100} onChange={event => update('tagline', event.target.value)} /></Field></div>
      <fieldset className="appearance-options"><legend>Accent palette</legend><div className="palette-options">{Object.entries(accents).map(([key, accent]) => <label key={key} className={`palette-option ${draft.accent === key ? 'selected' : ''}`}><input type="radio" name="accent" checked={draft.accent === key} onChange={() => update('accent', key as Appearance['accent'])} /><span style={{ background: accent.color }} aria-hidden="true" />{accent.label}{draft.accent === key && <Check size={15} aria-hidden="true" />}</label>)}</div></fieldset>
      <fieldset className="appearance-options"><legend>Information density</legend><div className="density-options">{(['comfortable', 'compact'] as const).map(density => <label key={density} className={`density-option ${draft.density === density ? 'selected' : ''}`}><input type="radio" name="density" checked={draft.density === density} onChange={() => update('density', density)} /><strong>{density === 'comfortable' ? 'Comfortable' : 'Compact'}</strong><span>{density === 'comfortable' ? 'Room to read and inspect' : 'More rows for larger runs'}</span></label>)}</div></fieldset>
      <label className="checkbox-line"><input type="checkbox" checked={draft.collapsed} onChange={event => update('collapsed', event.target.checked)} /> Start with a collapsed desktop sidebar</label>
      <div className="form-actions"><span className="muted">{dirty ? 'Unapplied changes' : 'Appearance is up to date'}</span><button className="btn btn-primary" type="submit" disabled={!dirty}>Apply appearance <Check size={16} /></button></div>
      {message && <p className="appearance-feedback" role="status">{message}</p>}{error && <div className="inline-error" role="alert">{error}</div>}{!storageAvailable && <div className="inline-error" role="status">Browser storage is unavailable. Your changes apply for this session; export them to keep a copy.</div>}
    </form><aside className="appearance-preview" style={{ '--preview-accent': accents[draft.accent].color } as CSSProperties}>
      <div className="eyebrow">LOCAL PREVIEW</div><div className="preview-workbench"><div className="preview-rail"><Activity size={21} /><i /><i /><i /></div><div className="preview-content"><div className="preview-brand">{draft.name || 'Your workbench'}</div><p>{draft.tagline || 'Your evaluation workspace'}</p><span className="preview-pill">Paired evaluation</span><div className={`preview-rows ${draft.density}`}><span /><span /><span /></div></div></div><p className="preview-caption">A visual preview of your identity and density. No evaluation data is included.</p>
      <div className="helper-callout"><Palette size={20} /><div><strong>Ready for a client handoff</strong><p>Set deployment defaults with <code>VITE_BRAND_NAME</code>, <code>VITE_BRAND_TAGLINE</code>, and <code>VITE_BRAND_ACCENT</code>. Browser preferences override them locally.</p></div></div>
    </aside></div>
    <section className="panel appearance-transfer"><SectionTitle title="Reuse your appearance" caption="The versioned JSON file contains only display settings. Importing opens a preview before applying." /><div className="button-group"><button className="btn btn-secondary" type="button" onClick={download}><Download size={16} /> Export applied appearance</button><button className="btn btn-secondary" type="button" onClick={() => input.current?.click()}><Upload size={16} /> Import appearance</button><button className="text-button" type="button" onClick={() => { setDraft(defaultAppearance); setTransferMessage('Deployment defaults loaded into preview. Apply to save.'); setTransferError(''); setMessage(''); setError('') }}><RotateCcw size={15} /> Preview defaults</button></div><input className="sr-only" type="file" accept=".json,application/json" tabIndex={-1} aria-label="Appearance JSON file" ref={input} onChange={event => { void importFile(event.target.files?.[0]) }} />{transferMessage && <p className="appearance-feedback" role="status">{transferMessage}</p>}{transferError && <div className="inline-error" role="alert">{transferError}</div>}</section>
  </div>
}
