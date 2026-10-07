import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, BookOpenText, Clock3, Database, FileChartColumn, FlaskConical, GitCompareArrows, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { api, dateTime, formatNumber, type Health, type User } from '../../lib/api'
import { EmptyState, ErrorState, LoadingState, SectionTitle, StatusBadge, Tag } from '../../components/Primitives'
import { useAppearance } from '../../lib/useAppearance'

export function OverviewPage({ user, health }: { user: User; health?: Health }) {
  const { appearance } = useAppearance()
  const datasets = useQuery({ queryKey: ['datasets'], queryFn: api.datasets })
  const experiments = useQuery({ queryKey: ['experiments'], queryFn: api.experiments, refetchInterval: 10_000 })
  const reviews = useQuery({ queryKey: ['reviews', ''], queryFn: () => api.reviews() })
  const runs = [...(experiments.data?.items ?? [])].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  const active = runs.filter(item => ['pending', 'running', 'queued', 'paused'].includes(item.status))
  const latest = runs.find(item => ['completed', 'review_pending', 'failed', 'budget_exhausted'].includes(item.status))
  const report = useQuery({ queryKey: ['report', latest?.id], queryFn: () => api.report(latest!.id), enabled: Boolean(latest) })
  const unresolved = reviews.data?.items.filter(item => ['pending', 'disagreement'].includes(item.status)).length
  const canWrite = user.role !== 'viewer'
  const demo = health?.mode === 'demo'
  const refresh = () => { void datasets.refetch(); void experiments.refetch(); void reviews.refetch(); if (latest) void report.refetch() }
  const refreshing = datasets.isFetching || experiments.isFetching || reviews.isFetching || report.isFetching
  const next = !datasets.data?.items.length ? { to: '/datasets', title: 'Version your first dataset', text: 'Import cases with reference answers and a held-out split.', cta: 'Open datasets', icon: Database }
    : active.length ? { to: '/experiments/' + active[0].id, title: 'Run in progress', text: active[0].name + ' is ' + active[0].status.replaceAll('_', ' ') + '. Inspect persisted outcomes.', cta: 'Open run console', icon: Clock3 }
    : unresolved ? { to: '/reviews', title: 'Human evidence needed', text: unresolved + ' unresolved assignments in the blinded review queue.', cta: 'Open review queue', icon: BookOpenText }
    : { to: canWrite ? '/experiments/new' : '/experiments', title: 'Ready for the next candidate', text: 'Compare two configurations on identical cases, then inspect the failures.', cta: canWrite ? 'Build a paired run' : 'View experiments', icon: FlaskConical }
  const NextIcon = next.icon
  return <div className="stack-page overview-page control-room">
    <header className="workbench-heading"><div><div className="eyebrow">{user.workspace_name} / EVALUATION OPERATIONS</div><h1>Evaluation workbench<span className="heading-marker" aria-hidden="true"> / </span></h1><p>{appearance.tagline || 'Evidence before release.'}</p></div><div className="button-group"><button className="btn btn-secondary" type="button" onClick={refresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'spin' : ''} /> Refresh</button><Link className="btn btn-primary" to={canWrite ? '/experiments/new' : '/experiments'}>{canWrite ? <Plus size={16} /> : <FlaskConical size={16} />}{canWrite ? 'New experiment' : 'Explore experiments'}</Link></div></header>
    <div className="scope-banner"><ShieldCheck size={17} /><div><strong>{demo ? 'Synthetic demonstration' : health ? 'Connected workspace' : 'Checking workspace mode'}</strong><span>{demo ? 'Fictional cases and deterministic fixtures. Live-model quality has not been measured.' : 'Recorded evidence only. Check each report for its source and limitations.'}</span></div>{demo && <Tag tone="amber">Demo data</Tag>}</div>
    <nav className="instrument-strip" aria-label="Workspace evidence">
      <Link to="/datasets" className="overview-stat"><span><Database size={15} /> Dataset cases</span><strong>{datasets.isError || datasets.isPending ? '—' : formatNumber(datasets.data.items.reduce((sum, item) => sum + item.case_count, 0))}</strong><small>{datasets.data?.items.length ?? '—'} latest snapshots</small></Link>
      <Link to="/experiments" className="overview-stat"><span><FlaskConical size={15} /> Paired experiments</span><strong>{experiments.isError || experiments.isPending ? '—' : formatNumber(runs.length)}</strong><small>{experiments.isSuccess ? active.length + ' active or paused' : 'Awaiting runs'}</small></Link>
      <Link to="/reviews" className="overview-stat"><span><BookOpenText size={15} /> Review assignments</span><strong>{reviews.isError || reviews.isPending ? '—' : formatNumber(unresolved)}</strong><small>Unresolved decisions</small></Link>
      <Link to={latest ? '/reports/' + latest.id : '/reports'} className="overview-stat"><span><FileChartColumn size={15} /> Latest release gate</span><strong className="stat-decision">{experiments.isPending ? 'Checking' : experiments.isError ? 'Unavailable' : !latest ? 'No report' : report.isError ? 'Unavailable' : report.isPending ? 'Checking' : report.data.decision}</strong><small>Recorded scope</small></Link>
    </nav>
    <div className="control-room-grid">
      <section className="panel run-ledger"><SectionTitle title="Experiment ledger" caption="Saved executions · newest first" action={<Link className="text-button" to="/experiments">All experiments <ArrowRight size={14} /></Link>} />
        {experiments.isPending ? <LoadingState label="Loading experiments" /> : experiments.isError ? <ErrorState error={experiments.error} retry={() => experiments.refetch()} /> : !runs.length ? <EmptyState title="Your first comparison starts here" description="Pick a dataset and two saved configurations to collect paired evidence." action={canWrite && <Link to="/experiments/new" className="btn btn-primary">Build experiment</Link>} /> : <div className="table-wrap ledger-table"><table><caption className="sr-only">Recent experiments, execution progress and saved status</caption><thead><tr><th>Experiment / split</th><th>Case runs</th><th>State</th><th className="align-right">Evidence</th></tr></thead><tbody>{runs.slice(0, 7).map(item => <tr key={item.id} className="overview-run"><td><Link className="table-title" to={'/experiments/' + item.id}>{item.name}</Link><span className="table-sub">{item.split.replaceAll('_', ' ')} · {dateTime(item.created_at)}</span></td><td><div className="ledger-progress"><span>{item.completed_runs} / {item.total_runs}</span><progress max={Math.max(1, item.total_runs)} value={item.completed_runs} aria-label={item.name + ': completed case runs'} /></div>{item.failed_runs > 0 && <span className="table-sub text-red">{item.failed_runs} failed</span>}</td><td><StatusBadge status={item.status} /></td><td className="align-right"><Link to={'/compare/' + item.id} className="ledger-evidence" aria-label={'Compare ' + item.name} title="Inspect paired comparison"><GitCompareArrows size={17} /><ArrowUpRight size={14} /></Link></td></tr>)}</tbody></table></div>}
        <div className="ledger-foot"><span>Immutable inputs. Persisted outcomes.</span><a className="text-button" href="#workflow">Explore the workflow <ArrowRight size={14} /></a></div>
      </section>
      <aside className="decision-column">
        <section className="panel decision-evidence"><div className="evidence-title"><span className="eyebrow">DECISION EVIDENCE</span><ShieldCheck size={17} /></div><h2>Latest release gate</h2>
          {experiments.isPending ? <LoadingState label="Finding release evidence" /> : experiments.isError ? <ErrorState error={experiments.error} retry={() => experiments.refetch()} compact /> : !latest ? <EmptyState title="Evidence is still ahead" description="Complete an experiment to generate a release report." /> : <>
            <p className="evidence-experiment">{latest.name}</p>{report.isPending ? <LoadingState label="Loading release evidence" /> : report.isError ? <ErrorState error={report.error} retry={() => report.refetch()} compact /> : <>
              <div className={'gate-result gate-' + report.data.decision}><StatusBadge status={report.data.decision} /><span>Recorded gate decision</span></div>
              <div className="coverage-evidence"><div><span>Paired coverage</span><strong>{report.data.comparison.paired_count} <span>/ {report.data.comparison.denominator}</span></strong></div><progress value={report.data.comparison.paired_count} max={Math.max(1, report.data.comparison.denominator)} aria-label="Recorded paired coverage" /><small>Planned pairs; scores have their own denominators.</small></div>
              <div className="direction-counts"><div><span className="text-red">Regressions</span><strong>{report.data.comparison.regressions.length}</strong></div><div><span className="text-green">Improvements</span><strong>{report.data.comparison.improvements.length}</strong></div></div>
              {report.data.limitations.length > 0 && <p className="evidence-limit"><span className="eyebrow">SCOPE LIMIT</span>{report.data.limitations[0]}</p>}
              <Tag>{report.data.source === 'simulated_history' ? 'Synthetic history' : report.data.source?.replaceAll('_', ' ') || 'Recorded experiment'}</Tag>
            </>}<Link to={'/reports/' + latest.id} className="btn btn-secondary btn-full">Inspect release report <ArrowRight size={15} /></Link>
          </>}
        </section>
        <section className="panel next-operation"><div className="eyebrow"><NextIcon size={14} /> NEXT OPERATION</div>{datasets.isPending || experiments.isPending || reviews.isPending ? <LoadingState label="Finding your next step" /> : datasets.isError || experiments.isError || reviews.isError ? <ErrorState error={datasets.error || experiments.error || reviews.error} retry={refresh} compact /> : <><h2>{next.title}</h2><p>{next.text}</p><Link to={next.to} className="text-button">{next.cta}<ArrowRight size={15} /></Link></>}</section>
      </aside>
    </div>
    <section id="workflow" className="workflow-section"><SectionTitle title="From change to evidence" caption="One repeatable release workflow." /><div className="workflow-steps">{[
      { to: '/datasets', title: 'Version the cases', text: 'Inputs, references, held-out splits', icon: Database },
      { to: '/experiments', title: 'Compare a pair', text: 'Same cases, explicit run limits', icon: GitCompareArrows },
      { to: '/reviews', title: 'Inspect & review', text: 'Failures and blinded decisions', icon: BookOpenText },
      { to: '/reports', title: 'Make the decision', text: 'Pinned gate, exportable evidence', icon: ShieldCheck },
    ].map(({ to, title, text, icon: Icon }, index) => <Link className="workflow-step" to={to} key={to}><span className="workflow-index">0{index + 1}</span><Icon size={18} /><div><h3>{title}</h3><p>{text}</p></div><ArrowUpRight size={14} /></Link>)}</div></section>
  </div>
}
