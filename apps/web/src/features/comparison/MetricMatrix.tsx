import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { formatNumber, type MetricSummary } from '../../lib/api'
import { EmptyState, SectionTitle } from '../../components/Primitives'

function value(metric: MetricSummary, number: number | null) {
  return number == null ? 'Unavailable' : `${formatNumber(number, metric.unit === '%' ? 1 : 3)}${metric.unit === '%' ? '%' : metric.unit && metric.unit !== 'score' ? ` ${metric.unit}` : ''}`
}

function MeanPlot({ metric }: { metric: MetricSummary }) {
  const a = metric.a.mean
  const b = metric.b.mean
  if (a == null || b == null) return <span className="muted">No paired means</span>
  const minimum = Math.min(0, a, b)
  const maximum = Math.max(metric.unit === 'score' ? 1 : 0, a, b) || 1
  const x = (number: number) => 8 + (number - minimum) / (maximum - minimum) * 108
  return <svg className="mean-plot" viewBox="0 0 126 46" role="img" aria-label={`${metric.label}: baseline ${value(metric, a)}, challenger ${value(metric, b)}. Axis ${minimum} to ${maximum}.`}>
    <title>{`A: ${value(metric, a)} · B: ${value(metric, b)} · Each metric has its own axis`}</title>
    <line className="plot-axis" x1="8" x2="116" y1="32" y2="32" />
    <line className="plot-a" x1={x(0)} x2={x(a)} y1="10" y2="10" /><circle className="plot-a-point" cx={x(a)} cy="10" r="3" />
    <line className="plot-b" x1={x(0)} x2={x(b)} y1="23" y2="23" /><circle className="plot-b-point" cx={x(b)} cy="23" r="3" />
    <text x="8" y="43">{formatNumber(minimum, 1)}</text><text x="116" y="43" textAnchor="end">{formatNumber(maximum, 1)}</text>
  </svg>
}

export function MetricMatrix({ metrics }: { metrics: MetricSummary[] }) {
  return <section className="panel metric-matrix"><SectionTitle title="Metric comparison matrix" caption="Recorded means, applicable samples and paired deltas. Units remain separate." action={<div className="plot-legend"><span><i /> A · Baseline</span><span><i /> B · Challenger</span></div>} />
    {!metrics.length ? <EmptyState title="No scores yet" description="Metrics appear after paired case outputs are evaluated." /> : <>
      <div className="matrix-scroll-hint">Scroll the matrix to inspect all columns on smaller screens.</div>
      <div className="table-wrap"><table><caption className="sr-only">Metrics, baseline and challenger means, delta, confidence interval and independent axis plots</caption><thead><tr><th>Metric / direction</th><th>A · Baseline</th><th>B · Challenger</th><th>Δ · B minus A</th><th>Confidence interval</th><th>Means / own axis</th></tr></thead><tbody>{metrics.map(metric => {
        const positive = metric.delta != null && (metric.direction === 'lower' ? metric.delta < 0 : metric.delta > 0)
        const negative = metric.delta != null && metric.delta !== 0 && !positive
        const Icon = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus
        return <tr key={metric.metric_key}><th scope="row"><strong>{metric.label || metric.metric_key.replaceAll('_', ' ')}</strong><span className="table-sub">{metric.direction === 'lower' ? '↓ Lower is better' : '↑ Higher is better'}</span></th><td className="matrix-value"><strong>{value(metric, metric.a.mean)}</strong><span className="table-sub">n = {metric.a.count}</span></td><td className="matrix-value challenger"><strong>{value(metric, metric.b.mean)}</strong><span className="table-sub">n = {metric.b.count}</span></td><td><span className={`matrix-delta ${positive ? 'text-green' : negative ? 'text-red' : ''}`}><Icon size={15} />{metric.delta == null ? 'Unavailable' : `${metric.delta > 0 ? '+' : ''}${value(metric, metric.delta)}`}</span><span className="table-sub">{positive ? 'Favorable' : negative ? 'Unfavorable' : metric.delta === 0 ? 'Unchanged' : 'Not evaluated'}</span></td><td className="matrix-ci">{metric.confidence_interval ? `[${formatNumber(metric.confidence_interval[0], 3)}, ${formatNumber(metric.confidence_interval[1], 3)}]` : 'Not recorded'}</td><td><MeanPlot metric={metric} /></td></tr>
      })}</tbody></table></div>
      <p className="matrix-footnote">Deltas use applicable paired outcomes; A and B sample counts can differ. A favorable change alone does not establish release readiness.</p>
    </>}
  </section>
}
