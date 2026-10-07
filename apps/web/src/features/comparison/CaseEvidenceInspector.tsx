import { FileSearch, X } from 'lucide-react'
import { formatMoney, formatNumber, type CaseRun, type PairedExample } from '../../lib/api'
import { ErrorState, JsonView, LoadingState, StatusBadge, Tag } from '../../components/Primitives'
import { ThemeControl } from '../../components/ThemeControl'

function RecordedOutput({ run, label }: { run: CaseRun | undefined; label: 'A' | 'B' }) {
  return <section className={`pair-side ${label === 'B' ? 'side-b' : ''}`}>
    <div className="pair-side-head"><span className={`candidate-letter ${label === 'B' ? 'b' : ''}`}>{label}</span><div><strong>{label === 'A' ? 'Baseline' : 'Challenger'}</strong>{run && <StatusBadge status={run.status} />}</div></div>
    {run ? <>
      {run.error_message && <div className="inline-error"><strong>{run.error_category?.replaceAll('_', ' ') || 'Recorded error'}</strong><br />{run.error_message}</div>}
      <div className="detail-block"><h4>Recorded output</h4><JsonView value={run.output} empty="No output recorded" /></div>
      <dl className="inspector-facts"><div><dt>Latency</dt><dd>{run.latency_ms == null ? 'Unknown' : `${formatNumber(run.latency_ms)} ms`}</dd></div><div><dt>Cost</dt><dd>{formatMoney(run.cost_usd)}</dd></div></dl>
      {run.scores?.filter(score => score.applicable).length > 0 && <div className="detail-block"><h4>Applicable scores</h4><div className="score-list">{run.scores.filter(score => score.applicable).map(score => <div key={score.metric_key}><span>{score.metric_key.replaceAll('_', ' ')}</span><strong>{score.value == null ? 'Unavailable' : formatNumber(score.value, 3)}</strong></div>)}</div></div>}
      <details className="inspector-context"><summary>Trace & tool events <span>{run.events?.length ?? 0}</span></summary>{run.events?.length ? <JsonView value={run.events} /> : <p>No local trace events were recorded.</p>}</details>
    </> : <p className="context-note">This candidate result is unavailable in the selected evidence.</p>}
  </section>
}

export function CaseEvidenceInspector({ pair, run, rows, loading, error, retry, onClose }: { pair: PairedExample | null; run: CaseRun | null; rows: CaseRun[]; loading: boolean; error: unknown; retry: () => void; onClose: () => void }) {
  const a = pair ? rows.find(row => row.id === pair.a.run_id) : run?.candidate_label === 'A' ? run : undefined
  const b = pair ? rows.find(row => row.id === pair.b.run_id) : run?.candidate_label === 'B' ? run : undefined
  const context = a ?? b
  return <div className="modal-backdrop inspector-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal pair-modal evidence-inspector" role="dialog" aria-modal="true" aria-labelledby="pair-title">
      <header className="inspector-header"><div><div className="eyebrow"><FileSearch size={14} /> {pair ? 'PAIRED CASE' : 'FAILURE'} / SAVED EVIDENCE</div><h2 id="pair-title">{pair?.case_key ?? run?.case_key}</h2></div><div className="button-group"><ThemeControl /><button className="icon-button" aria-label="Close case inspector" onClick={onClose}><X size={20} /></button></div></header>
      <div className="inspector-body">
        <div className="tag-row">{pair && <><Tag>{pair.task_type.replaceAll('_', ' ')}</Tag><Tag tone="cyan">{pair.metric_key?.replaceAll('_', ' ') ?? 'Task metric'}</Tag>{pair.delta != null && <Tag>Δ {pair.delta > 0 ? '+' : ''}{formatNumber(pair.delta, 3)}</Tag>}</>}{run && <Tag tone="red">{run.error_category || run.status}</Tag>}</div>
        {loading ? <LoadingState label="Loading saved case runs" /> : error ? <ErrorState error={error} retry={retry} /> : <>
          {context && <section className="inspector-input"><div className="detail-block"><h4>Case input</h4><JsonView value={context.input} /></div><details className="inspector-context"><summary>Reference answer & evidence context</summary><div className="pair-context"><div className="detail-block"><h4>Expected answer or action</h4><JsonView value={context.expected} /></div><div className="detail-block"><h4>Evidence context</h4><JsonView value={context.context} /></div></div></details></section>}
          <div className={`pair-grid ${pair ? '' : 'single-run'}`}>{(pair || a) && <RecordedOutput run={a} label="A" />}{(pair || b) && <RecordedOutput run={b} label="B" />}</div>
        </>}
        <p className="context-note">{pair ? 'Identical case, two candidates. Reference labels appear only in evaluator and reviewer views.' : 'This inspector shows the selected saved attempt, including its original error and output.'}</p>
      </div>
      <footer className="inspector-footer"><span>Persisted record · no re-execution</span><button className="btn btn-secondary" onClick={onClose}>Close inspector</button></footer>
    </div>
  </div>
}
