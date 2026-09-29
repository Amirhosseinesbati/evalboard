import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, CheckCircle2, ChevronDown,
  CircleAlert, CircleHelp, FileText, Filter, GitCompareArrows, Search, X,
} from 'lucide-react'
import { api, formatMoney, formatNumber, type CaseRun, type MetricSummary, type PairedExample } from '../../lib/api'
import { EmptyState, ErrorState, JsonView, LoadingState, PageHeader, SectionTitle, StatusBadge, Tag } from '../../components/Primitives'
import { useModalKeyboard } from '../../components/useModalKeyboard'

function MetricCard({ metric }: { metric: MetricSummary }) {
  const positive = metric.delta != null && (metric.direction === 'lower' ? metric.delta < 0 : metric.delta > 0)
  const negative = metric.delta != null && metric.delta !== 0 && !positive
  const tone = negative ? 'negative' : positive ? 'positive' : 'neutral'
  const display = (value: number | null) => value == null ? '—' : `${formatNumber(value, metric.unit === '%' ? 1 : 3)}${metric.unit === '%' ? '%' : metric.unit && metric.unit !== 'score' ? ` ${metric.unit}` : ''}`
  return <article className={`metric-card ${tone}`}>
    <div className="metric-card-top"><span>{metric.label || metric.metric_key.replace(/_/g, ' ')}</span><span className="metric-direction">{metric.direction === 'lower' ? '↓ lower is better' : '↑ higher is better'}</span></div>
    <div className="metric-values">
      <div><small>A · BASELINE</small><strong>{display(metric.a.mean)}</strong><span>n={metric.a.count}</span></div>
      <div className="metric-arrow"><ArrowRight size={18} /></div>
      <div><small>B · CHALLENGER</small><strong>{display(metric.b.mean)}</strong><span>n={metric.b.count}</span></div>
    </div>
    <div className="metric-delta"><span>{positive ? <ArrowUpRight size={16} /> : negative ? <ArrowDownRight size={16} /> : <CircleHelp size={16} />}{metric.delta == null ? 'Delta unavailable' : `${metric.delta > 0 ? '+' : ''}${display(metric.delta)} delta`}</span>{metric.confidence_interval && <small>CI [{formatNumber(metric.confidence_interval[0], 3)}, {formatNumber(metric.confidence_interval[1], 3)}]</small>}</div>
  </article>
}

function RunOutput({ run, label }: { run: CaseRun | undefined; label: 'A' | 'B' }) {
  return <div className={`pair-side ${label === 'B' ? 'side-b' : ''}`}>
    <div className="pair-side-head"><span className={`candidate-letter ${label === 'B' ? 'b' : ''}`}>{label}</span><div><strong>{label === 'A' ? 'Baseline' : 'Challenger'}</strong>{run && <StatusBadge status={run.status} />}</div></div>
    {run ? <>
      <div className="detail-block"><h4>Recorded output</h4><JsonView value={run.output} empty="No output recorded" /></div>
      {run.error_message && <div className="inline-error">{run.error_category ? `${run.error_category}: ` : ''}{run.error_message}</div>}
      <div className="pair-facts"><span>Latency <strong>{run.latency_ms == null ? '—' : `${formatNumber(run.latency_ms)} ms`}</strong></span><span>Cost <strong>{formatMoney(run.cost_usd)}</strong></span></div>
      {run.scores?.filter((score) => score.applicable).length > 0 && <div className="score-list">{run.scores.filter((score) => score.applicable).map((score) => <div key={score.metric_key}><span>{score.metric_key.replace(/_/g, ' ')}</span><strong>{score.value == null ? '—' : formatNumber(score.value, 3)}</strong></div>)}</div>}
      {run.events?.length ? <div className="detail-block"><h4>Trace and tool events</h4><JsonView value={run.events} /></div> : <p className="context-note">No local trace events were recorded.</p>}
    </> : <p className="muted">Case result unavailable.</p>}
  </div>
}

function PairDetail({ item, rows, loading, error, onClose }: { item: PairedExample; rows: CaseRun[]; loading: boolean; error: unknown; onClose: () => void }) {
  const a = rows.find((row) => row.id === item.a.run_id)
  const b = rows.find((row) => row.id === item.b.run_id)
  const context = a ?? b
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <div className="modal pair-modal" role="dialog" aria-modal="true" aria-labelledby="pair-title">
      <div className="panel-heading"><div><div className="eyebrow">PAIRED CASE EVIDENCE</div><h2 id="pair-title">{item.case_key}</h2><div className="tag-row"><Tag>{item.task_type.replace(/_/g, ' ')}</Tag><Tag tone="cyan">{item.metric_key?.replace(/_/g, ' ') ?? 'Task metric'}</Tag>{item.delta != null && <Tag tone={item.delta < 0 ? 'red' : 'green'}>Δ {formatNumber(item.delta, 3)}</Tag>}</div></div><button className="icon-button" aria-label="Close pair detail" onClick={onClose}><X size={20} /></button></div>
      {loading ? <LoadingState label="Loading saved case runs" /> : error ? <ErrorState error={error} /> : <>
        {context && <div className="pair-context"><div className="detail-block"><h4>Case input</h4><JsonView value={context.input} /></div><div className="detail-block"><h4>Expected answer or action</h4><JsonView value={context.expected} /></div><div className="detail-block"><h4>Evidence context</h4><JsonView value={context.context} /></div></div>}
        <div className="pair-grid"><RunOutput run={a} label="A" /><RunOutput run={b} label="B" /></div>
      </>}
      <p className="context-note">The same case was sent to both candidates. Reference labels appear only in evaluator and reviewer views.</p>
    </div>
  </div>
}

export function ComparisonPage() {
  const { experimentId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<'overview' | 'failures' | 'config'>('overview')
  const [search, setSearch] = useState('')
  const [taskFilter, setTaskFilter] = useState('all')
  const [selected, setSelected] = useState<PairedExample | null>(null)
  useModalKeyboard(Boolean(selected), 'pair-title', () => setSelected(null))
  const [kind, setKind] = useState<'regressions' | 'improvements'>('regressions')
  const experiments = useQuery({ queryKey: ['experiments'], queryFn: api.experiments })
  const selectedId = experimentId ?? searchParams.get('experiment') ?? experiments.data?.items.find((item) => item.status === 'completed')?.id ?? experiments.data?.items[0]?.id ?? ''
  const comparison = useQuery({ queryKey: ['comparison', selectedId], queryFn: () => api.comparison(selectedId), enabled: Boolean(selectedId) })
  const results = useQuery({ queryKey: ['results', selectedId], queryFn: () => api.results(selectedId), enabled: Boolean(selectedId) && (tab === 'failures' || selected !== null) })
  const data = comparison.data
  const entries = data?.[kind] ?? []
  const taskTypes = Array.from(new Set([...(data?.regressions ?? []), ...(data?.improvements ?? [])].map((item) => item.task_type)))
  const filtered = entries.filter((item) => (taskFilter === 'all' || taskFilter === item.task_type) && item.case_key.toLowerCase().includes(search.toLowerCase()))
  const failureRows = (results.data?.items ?? []).filter((item) => ['failed', 'uncertain', 'cancelled'].includes(item.status) || Boolean(item.error_category))
  const failedFiltered = failureRows.filter((item) => item.case_key.toLowerCase().includes(search.toLowerCase()) && (taskFilter === 'all' || item.error_category === taskFilter))
  const failureCategories = Array.from(new Set(failureRows.map((item) => item.error_category).filter((value): value is string => Boolean(value))))
  const chooseExperiment = (id: string) => { setSelected(null); setSearch(''); setTaskFilter('all'); if (experimentId) navigate(`/compare/${id}`); else setSearchParams({ experiment: id }) }

  return <div className="stack-page">
    <PageHeader eyebrow="03 / PAIRED ANALYSIS" title="Comparison" description="See what improved, what regressed, and which cases prove it." actions={selectedId && <Link to={`/reports/${selectedId}`} className="btn btn-primary"><FileText size={17} /> Release report</Link>} />
    <div className="compare-toolbar"><label className="field compact-field"><span className="field-label">EXPERIMENT</span><span className="select-inline"><GitCompareArrows size={17} /><select value={selectedId} onChange={(event) => chooseExperiment(event.target.value)}><option value="">Select experiment</option>{experiments.data?.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></span></label>{data && <div className="compare-toolbar-meta"><StatusBadge status={data.status} /><span>{data.paired_count} paired cases of {data.denominator} denominator</span></div>}</div>
    {experiments.isError && <ErrorState error={experiments.error} retry={() => experiments.refetch()} />}
    {!selectedId && !experiments.isPending ? <EmptyState title="No experiments to compare" description="Start a paired experiment first. Comparisons appear as cases finish." action={<Link to="/experiments/new" className="btn btn-primary">Build experiment</Link>} /> : comparison.isPending ? <LoadingState label="Computing paired comparison" /> : comparison.isError ? <ErrorState error={comparison.error} retry={() => comparison.refetch()} /> : data && <>
      <div className="compare-summary"><div className="compare-summary-main"><div className="eyebrow">PAIRED EVIDENCE</div><h2>{data.paired_count} <span>cases compared</span></h2><p>Counts include failed and missing outcomes. Metric summaries use their own applicable denominators.</p></div><div className="compare-count regression"><CircleAlert size={19} /><span>REGRESSIONS</span><strong>{data.regressions.length}</strong></div><div className="compare-count improvement"><CheckCircle2 size={19} /><span>IMPROVEMENTS</span><strong>{data.improvements.length}</strong></div></div>
      <div className="tab-bar" role="tablist" aria-label="Comparison views"><button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'active' : ''} onClick={() => { setTab('overview'); setTaskFilter('all') }}><BarChart3 size={17} /> Overview</button><button role="tab" aria-selected={tab === 'failures'} className={tab === 'failures' ? 'active' : ''} onClick={() => { setTab('failures'); setTaskFilter('all') }}><CircleAlert size={17} /> Failure explorer</button><button role="tab" aria-selected={tab === 'config'} className={tab === 'config' ? 'active' : ''} onClick={() => { setTab('config'); setTaskFilter('all') }}><GitCompareArrows size={17} /> Configuration diff</button></div>
      {tab === 'overview' && <>
        <section><SectionTitle title="Metric distributions" caption="Means and sample counts are shown per applicable metric." /><div className="metric-grid">{data.metrics.length ? data.metrics.map((metric) => <MetricCard metric={metric} key={metric.metric_key} />) : <EmptyState title="No scores yet" description="Metrics appear after paired case outputs are evaluated." />}</div></section>
        <section className="panel"><SectionTitle title="Example explorer" caption="Open a pair to inspect both outputs, evidence, errors, and applicable scores." action={<div className="filter-row"><label className="search-box"><Search size={16} /><span className="sr-only">Search case key</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cases" /></label><label className="select-wrap"><Filter size={16} /><span className="sr-only">Filter task type</span><select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option value="all">All task types</option>{taskTypes.map((type) => <option value={type} key={type}>{type.replace(/_/g, ' ')}</option>)}</select></label></div>} /><div className="segmented"><button className={kind === 'regressions' ? 'active' : ''} onClick={() => setKind('regressions')}>Regressions <span>{data.regressions.length}</span></button><button className={kind === 'improvements' ? 'active' : ''} onClick={() => setKind('improvements')}>Improvements <span>{data.improvements.length}</span></button></div>{filtered.length === 0 ? <EmptyState title={`No ${kind} match`} description={entries.length ? 'Adjust your search or task filter.' : `No ${kind} have been recorded for this comparison.`} /> : <div className="example-list">{filtered.map((item) => <button type="button" className="example-row" key={`${kind}-${item.case_id}-${item.repetition ?? 1}`} onClick={() => setSelected(item)}><span className={`example-indicator ${kind}`} aria-hidden="true" /><span className="example-main"><strong>{item.case_key}</strong><small>{item.task_type.replace(/_/g, ' ')}{item.repetition && item.repetition > 1 ? ` · repeat ${item.repetition}` : ''}</small></span><span className="example-outcomes"><StatusBadge status={item.a.status} /><ArrowRight size={15} /><StatusBadge status={item.b.status} /></span><span className={`example-delta ${kind}`}>{item.delta == null ? 'Δ —' : `Δ ${item.delta > 0 ? '+' : ''}${formatNumber(item.delta, 3)}`}</span><ArrowRight size={17} /></button>)}</div>}</section>
      </>}
      {tab === 'failures' && <section className="panel"><SectionTitle title="Failure explorer" caption="Timeouts, uncertain attempts, provider errors, and cancelled case runs remain in the denominator." action={<div className="filter-row"><label className="search-box"><Search size={16} /><span className="sr-only">Search failed case</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cases" /></label><label className="select-wrap"><Filter size={16} /><span className="sr-only">Filter error category</span><select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option value="all">All error types</option>{failureCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label></div>} />{results.isPending ? <LoadingState /> : results.isError ? <ErrorState error={results.error} retry={() => results.refetch()} /> : failedFiltered.length === 0 ? <EmptyState title="No failed cases match" description={failureRows.length ? 'Try another error type or search term.' : 'No failure outcomes are recorded for this experiment.'} /> : <div className="table-wrap"><table><thead><tr><th>Case</th><th>Candidate</th><th>Status</th><th>Category</th><th>Message</th></tr></thead><tbody>{failedFiltered.map((item) => <tr key={item.id}><td><strong>{item.case_key}</strong></td><td>{item.candidate_label}</td><td><StatusBadge status={item.status} /></td><td>{item.error_category || '—'}</td><td className="error-message-cell">{item.error_message || 'No message recorded'}</td></tr>)}</tbody></table></div>}</section>}
      {tab === 'config' && <section className="panel"><SectionTitle title="Configuration differences" caption="Saved configuration fields for the baseline and challenger." /><JsonView value={data.config_diff} empty="No configuration differences recorded." /></section>}
      {selected && <PairDetail item={selected} rows={results.data?.items ?? []} loading={results.isPending} error={results.error} onClose={() => setSelected(null)} />}
    </>}
  </div>
}
