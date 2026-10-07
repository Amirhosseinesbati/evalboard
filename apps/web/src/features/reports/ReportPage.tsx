import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowLeft, CalendarDays, CheckCircle2, ChevronDown, CircleAlert, ClipboardCheck, FileChartColumn, LockKeyhole, Settings2, ShieldCheck, X } from 'lucide-react'
import { api, dateTime, formatNumber, type ReleaseGate, type ReleaseReport, type User } from '../../lib/api'
import { EmptyState, ErrorState, Field, JsonView, LoadingState, PageHeader, SectionTitle, StatusBadge, Tag } from '../../components/Primitives'
import { useModalKeyboard } from '../../components/useModalKeyboard'

function GateEditor({ onClose, canWrite }: { onClose: () => void; canWrite: boolean }) {
  const gates = useQuery({ queryKey: ['gates'], queryFn: api.gates })
  const queryClient = useQueryClient()
  const [name, setName] = useState('Release gate')
  const [thresholds, setThresholds] = useState('{\n  "max_regressions": 0,\n  "min_task_delta": 0\n}')
  const [parseError, setParseError] = useState<string | null>(null)
  const create = useMutation({ mutationFn: (body: { name: string; thresholds: Record<string, number> }) => api.createGate(body), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['gates'] }); onClose() } })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    try {
      const parsed: unknown = JSON.parse(thresholds)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Thresholds must be a JSON object containing finite numeric values')
      setParseError(null)
      create.mutate({ name: name.trim(), thresholds: parsed as Record<string, number> })
    } catch (error) { setParseError(error instanceof Error ? error.message : 'Invalid JSON') }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="gate-editor-title">
      <div className="panel-heading"><div><div className="eyebrow">RELEASE POLICY</div><h2 id="gate-editor-title">Release gates</h2><p>Saved gates can be selected when creating a new experiment. An existing run keeps its pinned gate.</p></div><button className="icon-button" aria-label="Close gate editor" onClick={onClose}><X size={20} /></button></div>
      {canWrite && <form onSubmit={submit}><Field label="Gate name" required><input value={name} onChange={(event) => setName(event.target.value)} required /></Field><Field label="Thresholds JSON" required hint="Use max_regressions, min_task_delta, or min_{task_type}_delta"><textarea className="code-input" rows={7} value={thresholds} onChange={(event) => setThresholds(event.target.value)} spellCheck={false} /></Field>{parseError && <div className="inline-error" role="alert">{parseError}</div>}{create.isError && <ErrorState compact error={create.error} />}<div className="form-actions"><button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save gate'}</button></div></form>}
      {!canWrite && <p className="permission-note">Viewer access can inspect gates but cannot create them.</p>}
      <div className="existing-gates"><SectionTitle title="Existing gates" />{gates.isPending ? <LoadingState /> : gates.isError ? <ErrorState compact error={gates.error} retry={() => gates.refetch()} /> : gates.data?.items.length ? gates.data.items.map((gate: ReleaseGate) => <div key={gate.id}><strong>{gate.name}</strong><code>{gate.id.slice(0, 12)}</code></div>) : <p className="muted">No custom gates configured.</p>}</div>
    </div>
  </div>
}

function DecisionHero({ report }: { report: ReleaseReport }) {
  const decision = report.decision
  const synthetic = report.source === 'simulated_history' || report.source === 'fixture'
  return <div className={`decision-hero decision-${decision}`}>
    <div className="decision-icon">{decision === 'pass' ? <CheckCircle2 size={28} /> : decision === 'fail' ? <CircleAlert size={28} /> : <LockKeyhole size={28} />}</div>
    <div><div className="eyebrow">RELEASE DECISION</div><h2>{decision === 'pass' ? 'Gate passed' : decision === 'fail' ? 'Gate failed' : 'Decision incomplete'}</h2><p>{decision === 'pass' ? 'The configured thresholds passed on this recorded comparison.' : decision === 'fail' ? 'At least one release threshold failed. Inspect the evidence before shipping.' : 'This comparison lacks the evidence or reviews needed for a final decision.'}</p></div>
    <div className="decision-source"><Tag tone={synthetic ? 'amber' : 'cyan'}>{synthetic ? 'Simulated historical data' : report.source?.replace(/_/g, ' ') ?? 'Recorded result'}</Tag><span>Generated {dateTime(report.generated_at)}</span></div>
  </div>
}

export function ReportPage({ user }: { user: User }) {
  const { experimentId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [showGateEditor, setShowGateEditor] = useState(false)
  useModalKeyboard(showGateEditor, 'gate-editor-title', () => setShowGateEditor(false))
  const [downloadError, setDownloadError] = useState<unknown>(null)
  const [downloading, setDownloading] = useState<'json' | 'markdown' | null>(null)
  const experiments = useQuery({ queryKey: ['experiments'], queryFn: api.experiments })
  const selectedId = experimentId ?? searchParams.get('experiment') ?? experiments.data?.items.find((item) => item.status === 'completed')?.id ?? experiments.data?.items[0]?.id ?? ''
  const report = useQuery({ queryKey: ['report', selectedId], queryFn: () => api.report(selectedId), enabled: Boolean(selectedId) })
  const data = report.data
  const gate = data?.gate && typeof data.gate === 'object' ? data.gate as Record<string, unknown> : null
  const gateName = gate && typeof gate.name === 'string' ? gate.name : 'Threshold evaluation'
  const failures = gate && Array.isArray(gate.failures) ? gate.failures : []
  const taskRows = Object.entries(data?.comparison.primary?.by_task ?? {})
  const download = async (format: 'json' | 'markdown') => {
    setDownloadError(null)
    setDownloading(format)
    try { await api.downloadReport(selectedId, format) } catch (error) { setDownloadError(error) } finally { setDownloading(null) }
  }
  const chooseExperiment = (id: string) => { if (experimentId) navigate(`/reports/${id}`); else setSearchParams({ experiment: id }) }

  return <div className="stack-page report-page">
    <PageHeader eyebrow="05 / RELEASE EVIDENCE" title="Release reports" description="A reproducible comparison and explicit release gate for CI and human review." actions={selectedId && <div className="button-group"><button className="btn btn-secondary" onClick={() => setShowGateEditor(true)}><Settings2 size={16} /> Gates</button><button className="btn btn-primary" onClick={() => download('json')} disabled={Boolean(downloading)}><ArrowDownToLine size={17} /> {downloading === 'json' ? 'Exporting…' : 'Export JSON'}</button></div>} />
    <div className="compare-toolbar"><label className="field compact-field"><span className="field-label">EXPERIMENT</span><span className="select-inline"><FileChartColumn size={17} /><select value={selectedId} onChange={(event) => chooseExperiment(event.target.value)}><option value="">Select experiment</option>{experiments.data?.items.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></span></label>{data && <div className="compare-toolbar-meta"><StatusBadge status={data.decision} /><span>Report contract v{data.version ?? '1'}</span></div>}</div>
    {experiments.isError && <ErrorState error={experiments.error} retry={() => experiments.refetch()} />}
    {downloadError != null && <ErrorState compact error={downloadError} retry={() => setDownloadError(null)} />}
    {!selectedId && !experiments.isPending ? <EmptyState title="No reports available" description="Start and complete a paired experiment to generate release evidence." action={<Link to="/experiments/new" className="btn btn-primary">Build experiment</Link>} /> : report.isPending ? <LoadingState label="Generating release report" /> : report.isError ? <ErrorState error={report.error} retry={() => report.refetch()} /> : data && <>
      <DecisionHero report={data} />
      <div className="report-actions"><button className="btn btn-secondary" onClick={() => download('markdown')} disabled={Boolean(downloading)}><ArrowDownToLine size={16} /> {downloading === 'markdown' ? 'Exporting…' : 'Download Markdown'}</button><Link className="btn btn-ghost" to={`/compare/${selectedId}`}><ArrowLeft size={16} /> Back to comparison</Link></div>
      <div className="report-grid"><section className="panel"><SectionTitle title="Decision evidence" caption="Counts and deltas come from persisted paired outputs." />
        <div className="report-count-grid"><div><span>PAIRED CASES</span><strong>{formatNumber(data.comparison.paired_count)}</strong><small>of {formatNumber(data.comparison.denominator)} denominator</small></div><div><span>REGRESSIONS</span><strong className="text-red">{formatNumber(data.comparison.regressions.length)}</strong><small>Case-level examples</small></div><div><span>IMPROVEMENTS</span><strong className="text-green">{formatNumber(data.comparison.improvements.length)}</strong><small>Case-level examples</small></div><div><span>PENDING REVIEWS</span><strong>{formatNumber(data.pending_reviews)}</strong><small>Human assignments</small></div></div>
        <div className="report-metrics"><h3>Task-specific paired correctness</h3><p className="muted">No universal quality score is computed across incompatible tasks.</p><div className="table-wrap" role="region" aria-label="Task-specific paired correctness table, scroll horizontally for all columns" tabIndex={0}><table><thead><tr><th>Task</th><th>Mean delta</th><th>Paired n</th><th>Planned n</th><th>95% interval</th></tr></thead><tbody>{taskRows.map(([task, row]) => <tr key={task}><td><strong>{task.replace(/_/g, ' ')}</strong></td><td>{row.mean_delta == null ? '—' : `${row.mean_delta > 0 ? '+' : ''}${formatNumber(row.mean_delta, 3)}`}</td><td>{row.count}</td><td>{row.planned_count}</td><td>{row.confidence_interval ? `[${formatNumber(row.confidence_interval[0], 3)}, ${formatNumber(row.confidence_interval[1], 3)}]` : 'Not justified'}</td></tr>)}</tbody></table></div></div>
        <div className="report-metrics"><h3>Applicable metrics</h3><div className="table-wrap" role="region" aria-label="Applicable metrics table, scroll horizontally for all columns" tabIndex={0}><table><thead><tr><th>Metric</th><th>A mean</th><th>B mean</th><th>Δ B − A</th><th>n A / B</th></tr></thead><tbody>{data.comparison.metrics.map((metric) => <tr key={metric.metric_key}><td><strong>{metric.label || metric.metric_key}</strong><span className="table-sub">{metric.direction} is better · {metric.unit}</span></td><td>{formatNumber(metric.a.mean, 3)}</td><td>{formatNumber(metric.b.mean, 3)}</td><td>{metric.delta == null ? '—' : `${metric.delta > 0 ? '+' : ''}${formatNumber(metric.delta, 3)}`}</td><td>{metric.a.count} / {metric.b.count}</td></tr>)}</tbody></table></div></div>
      </section><aside className="report-aside"><section className="panel"><div className="report-card-icon"><ShieldCheck size={19} /></div><SectionTitle title="Release gate" caption={gateName} />{gate ? <><div className="detail-block"><h4>Thresholds</h4><JsonView value={gate.thresholds ?? gate} /></div>{failures.length ? <div className="gate-failures"><h4>Failed conditions</h4>{failures.map((failure, index) => <div key={index}><CircleAlert size={15} />{typeof failure === 'string' ? failure : JSON.stringify(failure)}</div>)}</div> : <p className="muted">No gate failures recorded.</p>}</> : <p className="muted">No gate is attached to this report.</p>}</section><section className="panel"><div className="report-card-icon"><CalendarDays size={19} /></div><SectionTitle title="Limitations" caption="Interpret the decision within these bounds." />{data.limitations.length ? <ul className="limitation-list">{data.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p className="muted">No limitations recorded.</p>}</section></aside></div>
      <div className="helper-callout"><ClipboardCheck size={20} /><div><strong>Reproducible artifact</strong><p>The export includes the saved configuration comparison, metric counts, task-specific deltas, release threshold result, and limitations. Use its JSON form in CI.</p></div></div>
    </>}
    {showGateEditor && <GateEditor onClose={() => setShowGateEditor(false)} canWrite={user.role !== 'viewer'} />}
  </div>
}
