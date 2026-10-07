import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight, Filter, FlaskConical, GitCompareArrows, Plus, Search, ShieldCheck } from 'lucide-react'
import { api, dateTime, type User } from '../../lib/api'
import { EmptyState, ErrorState, LoadingState, PageHeader, SectionTitle, StatusBadge } from '../../components/Primitives'

export function ExperimentsPage({ user }: { user: User }) {
  const experiments = useQuery({ queryKey: ['experiments'], queryFn: api.experiments, refetchInterval: 10_000 })
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const status = params.get('status') ?? 'all'
  const split = params.get('split') ?? 'all'
  const sort = params.get('sort') ?? 'newest'
  const update = (key: string, value: string) => setParams(current => { const next = new URLSearchParams(current); if (!value || value === 'all' || (key === 'sort' && value === 'newest')) next.delete(key); else next.set(key, value); return next }, { replace: true })
  const items = experiments.data?.items ?? []
  const activeStatuses = ['pending', 'running', 'queued', 'paused']
  const attentionStatuses = ['failed', 'uncertain', 'budget_exhausted']
  const shown = items.filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase()) && (split === 'all' || item.split === split) && (status === 'all' || (status === 'active' ? activeStatuses.includes(item.status) : status === 'attention' ? attentionStatuses.includes(item.status) : item.status === status)))
    .sort((a, b) => sort === 'oldest' ? (a.created_at ?? '').localeCompare(b.created_at ?? '') : (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  const filtered = Boolean(search || status !== 'all' || split !== 'all')
  const clear = () => setParams(current => { const next = new URLSearchParams(current); ['q', 'status', 'split'].forEach(key => next.delete(key)); return next }, { replace: true })
  return <div className="stack-page"><PageHeader eyebrow="02 / PAIRED RUNS" title="Experiments" description="Run two configurations against the same versioned cases and keep every outcome in the denominator." actions={user.role !== 'viewer' && <Link to="/experiments/new" className="btn btn-primary"><Plus size={17} /> New experiment</Link>} />
    <div className="stat-strip"><div><span className="stat-label">TOTAL RUNS</span><strong>{experiments.isSuccess ? items.length : '—'}</strong><small>In this workspace</small></div><div><span className="stat-label">ACTIVE</span><strong>{experiments.isSuccess ? items.filter(item => activeStatuses.includes(item.status)).length : '—'}</strong><small>Including paused runs</small></div><div className="stat-note"><GitCompareArrows size={23} /><span>Results are paired by case and configuration. Failed or timed-out cases remain visible.</span></div></div>
    <section className="panel"><SectionTitle title="Run history" caption="Find a run by name, lifecycle, or case split. Filters stay in the page URL." />
      <div className="discovery-toolbar"><div className="filter-row"><label className="search-box"><Search size={16} /><span className="sr-only">Search experiments</span><input type="search" value={search} onChange={event => update('q', event.target.value)} placeholder="Find an experiment…" /></label><label className="select-wrap"><Filter size={15} /><span className="sr-only">Filter experiment status</span><select value={status} onChange={event => update('status', event.target.value)}><option value="all">All statuses</option><option value="active">Active & paused</option><option value="attention">Needs attention</option><option value="review_pending">Awaiting review</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label><label className="select-wrap"><span className="sr-only">Filter experiment split</span><select value={split} onChange={event => update('split', event.target.value)}><option value="all">All splits</option><option value="development">Development</option><option value="held_out">Held out</option></select></label></div><label className="select-wrap"><span className="sr-only">Sort experiments</span><select value={sort} onChange={event => update('sort', event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>
      <div className="filter-summary" role="status"><span>{experiments.isSuccess ? `${shown.length} of ${items.length} experiments` : 'Loading experiments'}</span>{filtered && <button type="button" className="text-button" onClick={clear}>Clear filters</button>}</div>
      {experiments.isPending ? <LoadingState /> : experiments.isError ? <ErrorState error={experiments.error} retry={() => experiments.refetch()} /> : items.length === 0 ? <EmptyState title="No experiments yet" description="Select a dataset and two configurations to start a paired run." action={user.role !== 'viewer' && <Link to="/experiments/new" className="btn btn-primary">Build experiment</Link>} /> : shown.length === 0 ? <EmptyState title="No matching experiments" description="Try another name, status, or split. Your saved runs are still here." action={<button className="btn btn-secondary" onClick={clear}>Clear filters</button>} /> : <div className="experiment-list">{shown.map(item => {
        const percent = item.total_runs > 0 ? Math.min(100, Math.round((item.completed_runs + item.failed_runs) / item.total_runs * 100)) : 0
        return <Link className="experiment-item" to={`/experiments/${item.id}`} key={item.id}><div className="experiment-item-main"><div className="experiment-icon"><FlaskConical size={19} /></div><div><div className="experiment-item-title"><strong>{item.name}</strong><StatusBadge status={item.status} /></div><p>{dateTime(item.created_at)} <span>·</span> {item.split.replace('_', ' ')} <span>·</span> {item.total_runs} case runs</p></div></div><div className="experiment-item-progress"><div className="progress-meta"><span>{item.completed_runs + item.failed_runs} / {item.total_runs}</span><strong>{percent}%</strong></div><div className="progress-track"><span style={{ width: `${percent}%` }} /></div></div><ChevronRight size={18} className="list-chevron" /></Link>
      })}</div>}
    </section><div className="helper-callout"><ShieldCheck size={20} /><div><strong>Reproducible by design</strong><p>Each run pins a dataset version and two saved configurations. Existing case outputs are persisted before evaluation.</p></div></div>
  </div>
}
