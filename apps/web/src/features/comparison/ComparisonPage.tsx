import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowRight, BarChart3, CheckCircle2, ChevronDown,
  CircleAlert, FileText, Filter, GitCompareArrows, Search,
} from 'lucide-react'
import { api, formatNumber, type CaseRun, type PairedExample } from '../../lib/api'
import { EmptyState, ErrorState, JsonView, LoadingState, PageHeader, SectionTitle, StatusBadge } from '../../components/Primitives'
import { useModalKeyboard } from '../../components/useModalKeyboard'
import { MetricMatrix } from './MetricMatrix'
import { CaseEvidenceInspector } from './CaseEvidenceInspector'

export function ComparisonPage() {
  const { experimentId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<'overview' | 'failures' | 'config'>('overview')
  const [search, setSearch] = useState('')
  const [taskFilter, setTaskFilter] = useState('all')
  const [selected, setSelected] = useState<PairedExample | null>(null)
  const [selectedRun, setSelectedRun] = useState<CaseRun | null>(null)
  const closeInspector = () => { setSelected(null); setSelectedRun(null) }
  useModalKeyboard(Boolean(selected || selectedRun), 'pair-title', closeInspector)
  const [kind, setKind] = useState<'regressions' | 'improvements'>('regressions')
  const experiments = useQuery({ queryKey: ['experiments'], queryFn: api.experiments })
  const selectedId = experimentId ?? searchParams.get('experiment') ?? experiments.data?.items.find((item) => item.status === 'completed')?.id ?? experiments.data?.items[0]?.id ?? ''
  const comparison = useQuery({ queryKey: ['comparison', selectedId], queryFn: () => api.comparison(selectedId), enabled: Boolean(selectedId) })
  const results = useQuery({ queryKey: ['results', selectedId], queryFn: () => api.results(selectedId), enabled: Boolean(selectedId) && (tab === 'failures' || selected !== null || selectedRun !== null) })
  const data = comparison.data
  const entries = data?.[kind] ?? []
  const taskTypes = Array.from(new Set([...(data?.regressions ?? []), ...(data?.improvements ?? [])].map((item) => item.task_type)))
  const filtered = entries.filter((item) => (taskFilter === 'all' || taskFilter === item.task_type) && item.case_key.toLowerCase().includes(search.toLowerCase()))
  const failureRows = (results.data?.items ?? []).filter((item) => ['failed', 'uncertain', 'cancelled'].includes(item.status) || Boolean(item.error_category))
  const failedFiltered = failureRows.filter((item) => item.case_key.toLowerCase().includes(search.toLowerCase()) && (taskFilter === 'all' || item.error_category === taskFilter))
  const failureCategories = Array.from(new Set(failureRows.map((item) => item.error_category).filter((value): value is string => Boolean(value))))
  const chooseExperiment = (id: string) => { closeInspector(); setSearch(''); setTaskFilter('all'); if (experimentId) navigate(`/compare/${id}`); else setSearchParams({ experiment: id }) }

  return <div className="stack-page comparison-workbench">
    <PageHeader eyebrow="03 / PAIRED ANALYSIS" title="Comparison" description="See what improved, what regressed, and which cases prove it." actions={selectedId && <Link to={`/reports/${selectedId}`} className="btn btn-primary"><FileText size={17} /> Release report</Link>} />
    <div className="compare-toolbar"><label className="field compact-field"><span className="field-label">EXPERIMENT</span><span className="select-inline"><GitCompareArrows size={17} /><select value={selectedId} onChange={(event) => chooseExperiment(event.target.value)}><option value="">Select experiment</option>{experiments.data?.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></span></label>{data && <div className="compare-toolbar-meta"><StatusBadge status={data.status} /><span>{data.paired_count} paired cases of {data.denominator} denominator</span></div>}</div>
    {experiments.isError && <ErrorState error={experiments.error} retry={() => experiments.refetch()} />}
    {!selectedId && !experiments.isPending ? <EmptyState title="No experiments to compare" description="Start a paired experiment first. Comparisons appear as cases finish." action={<Link to="/experiments/new" className="btn btn-primary">Build experiment</Link>} /> : comparison.isPending ? <LoadingState label="Computing paired comparison" /> : comparison.isError ? <ErrorState error={comparison.error} retry={() => comparison.refetch()} /> : data && <>
      <div className="compare-summary"><div className="compare-summary-main"><div className="eyebrow">PAIRED EVIDENCE</div><h2>{data.paired_count} <span>cases compared</span></h2><p>Counts include failed and missing outcomes. Metric summaries use their own applicable denominators.</p></div><div className="compare-count regression"><CircleAlert size={19} /><span>REGRESSIONS</span><strong>{data.regressions.length}</strong></div><div className="compare-count improvement"><CheckCircle2 size={19} /><span>IMPROVEMENTS</span><strong>{data.improvements.length}</strong></div></div>
      <div className="tab-bar" role="tablist" aria-label="Comparison views" onKeyDown={event => {
        const tabs = ['overview', 'failures', 'config'] as const
        const index = tabs.indexOf(tab)
        const target = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[2] : null
        if (!target) return
        event.preventDefault(); setTab(target); setTaskFilter('all')
        document.getElementById('comparison-tab-' + target)?.focus()
      }}>{([{ id: 'overview', label: 'Overview', icon: BarChart3 }, { id: 'failures', label: 'Failure explorer', icon: CircleAlert }, { id: 'config', label: 'Configuration diff', icon: GitCompareArrows }] as const).map(({ id, label, icon: Icon }) => <button key={id} id={'comparison-tab-' + id} role="tab" aria-selected={tab === id} aria-controls={'comparison-panel-' + id} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setTaskFilter('all') }}><Icon size={17} />{label}</button>)}</div>
      {tab === 'overview' && <div role="tabpanel" id="comparison-panel-overview" aria-labelledby="comparison-tab-overview">
        <MetricMatrix metrics={data.metrics} />
        <section className="panel"><SectionTitle title="Example explorer" caption="Open a pair to inspect both outputs, evidence, errors, and applicable scores." action={<div className="filter-row"><label className="search-box"><Search size={16} /><span className="sr-only">Search case key</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cases" /></label><label className="select-wrap"><Filter size={16} /><span className="sr-only">Filter task type</span><select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option value="all">All task types</option>{taskTypes.map((type) => <option value={type} key={type}>{type.replace(/_/g, ' ')}</option>)}</select></label></div>} /><div className="segmented"><button className={kind === 'regressions' ? 'active' : ''} onClick={() => setKind('regressions')}>Regressions <span>{data.regressions.length}</span></button><button className={kind === 'improvements' ? 'active' : ''} onClick={() => setKind('improvements')}>Improvements <span>{data.improvements.length}</span></button></div>{filtered.length === 0 ? <EmptyState title={`No ${kind} match`} description={entries.length ? 'Adjust your search or task filter.' : `No ${kind} have been recorded for this comparison.`} /> : <div className="example-list">{filtered.map((item) => <button type="button" className="example-row" key={`${kind}-${item.case_id}-${item.repetition ?? 1}`} onClick={() => setSelected(item)}><span className={`example-indicator ${kind}`} aria-hidden="true" /><span className="example-main"><strong>{item.case_key}</strong><small>{item.task_type.replace(/_/g, ' ')}{item.repetition && item.repetition > 1 ? ` · repeat ${item.repetition}` : ''}</small></span><span className="example-outcomes"><StatusBadge status={item.a.status} /><ArrowRight size={15} /><StatusBadge status={item.b.status} /></span><span className={`example-delta ${kind}`}>{item.delta == null ? 'Δ —' : `Δ ${item.delta > 0 ? '+' : ''}${formatNumber(item.delta, 3)}`}</span><ArrowRight size={17} /></button>)}</div>}</section>
      </div>}
      {tab === 'failures' && <section className="panel" role="tabpanel" id="comparison-panel-failures" aria-labelledby="comparison-tab-failures"><SectionTitle title="Failure explorer" caption="Timeouts, uncertain attempts, provider errors, and cancelled case runs remain in the denominator." action={<div className="filter-row"><label className="search-box"><Search size={16} /><span className="sr-only">Search failed case</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cases" /></label><label className="select-wrap"><Filter size={16} /><span className="sr-only">Filter error category</span><select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option value="all">All error types</option>{failureCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label></div>} />{results.isPending ? <LoadingState /> : results.isError ? <ErrorState error={results.error} retry={() => results.refetch()} /> : failedFiltered.length === 0 ? <EmptyState title="No failed cases match" description={failureRows.length ? 'Try another error type or search term.' : 'No failure outcomes are recorded for this experiment.'} /> : <div className="table-wrap"><table><thead><tr><th>Case</th><th>Candidate</th><th>Status</th><th>Category</th><th>Message</th></tr></thead><tbody>{failedFiltered.map((item) => <tr key={item.id}><td><button type="button" className="table-title button-link" onClick={() => setSelectedRun(item)}>{item.case_key}</button><span className="table-sub">Inspect saved attempt</span></td><td>{item.candidate_label}</td><td><StatusBadge status={item.status} /></td><td>{item.error_category || '—'}</td><td className="error-message-cell">{item.error_message || 'No message recorded'}</td></tr>)}</tbody></table></div>}</section>}
      {tab === 'config' && <section className="panel" role="tabpanel" id="comparison-panel-config" aria-labelledby="comparison-tab-config"><SectionTitle title="Configuration differences" caption="Saved configuration fields for the baseline and challenger." /><JsonView value={data.config_diff} empty="No configuration differences recorded." /></section>}
      {(selected || selectedRun) && <CaseEvidenceInspector pair={selected} run={selectedRun} rows={results.data?.items ?? []} loading={results.isPending} error={results.error} retry={() => { void results.refetch() }} onClose={closeInspector} />}
    </>}
  </div>
}
