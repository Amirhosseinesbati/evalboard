import type { ReactNode } from 'react'
import { AlertCircle, ArrowRight, LoaderCircle, RefreshCw } from 'lucide-react'
import { ApiError } from '../lib/api'

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>
}

export function SectionTitle({ title, caption, action }: { title: string; caption?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{caption && <p>{caption}</p>}</div>{action}</div>
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-glyph"><ArrowRight size={20} /></div><h3>{title}</h3><p>{description}</p>{action}</div>
}

export function LoadingState({ label = 'Loading data' }: { label?: string }) {
  return <div className="loading-state" role="status"><LoaderCircle className="spin" size={22} /><span>{label}…</span></div>
}

export function ErrorState({ error, retry, compact = false }: { error: unknown; retry?: () => void; compact?: boolean }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  const permission = error instanceof ApiError && error.status === 403
  return <div className={`error-state ${compact ? 'compact' : ''}`} role="alert"><AlertCircle size={20} /><div><strong>{permission ? 'Access denied' : 'Unable to load this view'}</strong><p>{message}</p>{error instanceof ApiError && error.validation.length > 0 && <ul>{error.validation.map((item, index) => <li key={index}>{item.row ? `Row ${item.row}: ` : ''}{item.message}</li>)}</ul>}</div>{retry && <button className="btn btn-secondary" type="button" onClick={retry}><RefreshCw size={15} /> Retry</button>}</div>
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase().replace(/_/g, '-')
  return <span className={`status status-${normalized}`}><i aria-hidden="true" />{status.replace(/_/g, ' ')}</span>
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'cyan' | 'red' | 'green' | 'amber' }) {
  return <span className={`tag tag-${tone}`}>{children}</span>
}

export function Field({ label, hint, children, required = false }: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return <label className="field"><span className="field-label">{label}{required && <span aria-hidden="true"> *</span>}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function JsonView({ value, empty = 'No data' }: { value: unknown; empty?: string }) {
  if (value == null) return <span className="muted">{empty}</span>
  return <pre className="json-view">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
}
