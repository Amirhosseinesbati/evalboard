export type Role = 'admin' | 'operator' | 'viewer' | 'reviewer'
export type RunStatus = 'pending' | 'queued' | 'running' | 'paused' | 'review_pending' | 'completed' | 'failed' | 'cancelled' | 'uncertain' | 'budget_exhausted'
export type CaseRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'uncertain' | 'cancelled'

export interface User { id: string; username: string; role: Role; workspace_id: string; workspace_name: string }
export interface Health { status: string; mode: 'demo' | 'connected'; database: string }
export interface Dataset { id: string; name: string; latest_version_id: string; version_count: number; case_count: number; description?: string; created_at?: string }
export interface DatasetVersion { id: string; dataset_id: string; version_number?: number; case_count?: number; created_at?: string }
export interface EvalCase {
  id: string; case_key: string; task_type: string; split: 'development' | 'held_out' | string
  input: Record<string, unknown> | string; expected: Record<string, unknown> | string | null
  tags: string[]; context: Record<string, unknown> | string | null
}
export interface ImportResponse { dataset: Dataset; version: DatasetVersion; imported_count?: number }
export interface ValidationError { row?: number; message: string; field?: string }
export interface Target { id: string; name: string; kind: 'bundled' | 'http' | 'openai' | 'recorded'; endpoint?: string | null; has_secret_ref?: boolean; connection_status?: 'ready' | 'configured_unverified' | 'missing_credentials'; recorded_case_count?: number }
export interface CandidateConfig {
  id: string; name: string; target_id: string; model_id: string; prompt: string
  options: Record<string, unknown>; budget_usd: number | null; concurrency: number
  created_at?: string
}
export interface Experiment {
  id: string; name: string; dataset_version_id: string; candidate_a_id: string; candidate_b_id: string
  split: 'development' | 'held_out' | 'all'; status: RunStatus
  progress?: number; total_runs: number; completed_runs: number; failed_runs: number
  budget_usd?: number | null; spent_usd?: number | null; started_at?: string; finished_at?: string
  created_at?: string; failure_reason?: string; max_cases?: number; repetitions?: number
}
export interface Score { metric_key: string; value: number | null; applicable: boolean; unit: string; direction: 'higher' | 'lower' | string }
export interface CaseOutput { answer?: string; action?: string; arguments?: Record<string, unknown>; evidence_ids?: string[]; abstained?: boolean; [key: string]: unknown }
export interface CaseRun {
  id: string; case_id: string; case_key: string; candidate_label: 'A' | 'B'; status: CaseRunStatus
  input?: Record<string, unknown> | string; expected?: Record<string, unknown> | string | null; context?: Record<string, unknown> | string | null
  output: CaseOutput | null; error_category?: string | null; error_message?: string | null
  latency_ms?: number | null; queue_wait_ms?: number | null; input_tokens?: number | null
  output_tokens?: number | null; cost_usd?: number | null; scores: Score[]
  events?: Array<{ id?: string; kind: string; created_at?: string; payload?: unknown }>
}
export interface MetricSummary {
  metric_key: string; label: string; unit: string; direction: string
  a: { mean: number | null; count: number }; b: { mean: number | null; count: number }
  delta: number | null; confidence_interval?: [number, number] | null
}
export interface PairSideSummary { run_id: string; answer?: string | null; score?: number | null; status: CaseRunStatus }
export interface PairedExample { case_id: string; case_key: string; task_type: string; repetition?: number; metric_key?: string; a: PairSideSummary; b: PairSideSummary; delta?: number | null }
export interface Comparison {
  experiment_id: string; status: RunStatus; paired_count: number; denominator: number
  missing_pairs?: number
  metrics: MetricSummary[]; regressions: PairedExample[]; improvements: PairedExample[]
  primary?: { description: string; by_task: Record<string, { mean_delta: number | null; count: number; planned_count: number; confidence_interval?: [number, number] | null }> }
  config_diff: Record<string, unknown>; counts: Record<string, number>
}
export interface ReviewAssignment {
  id: string; experiment_id: string; case_key: string; task_type: string
  prompt: unknown; evidence?: unknown; output_left: unknown; output_right: unknown; status_left?: string; status_right?: string; side_map_hidden: boolean
  status: string; decisions: Array<{ label: string; score?: number | null; notes?: string; reviewer_id?: string }>
  adjudication?: { label: string; notes?: string } | null
}
export interface ReleaseGate {
  id: string; name: string; metric_key?: string; min_delta?: number | null; max_regressions?: number | null
  max_cost_increase_usd?: number | null; thresholds?: Record<string, unknown>; failures?: string[]
}
export interface ReleaseReport {
  version?: string | number; source?: string; experiment_id: string; decision: 'pass' | 'fail' | 'incomplete'; gate: ReleaseGate | Record<string, unknown> | null
  comparison: Comparison
  generated_at: string; pending_reviews?: number; limitations: string[]
}
export interface ExperimentEvent { id: string; kind: string; created_at: string; payload: Record<string, unknown> }
export interface ListResponse<T> { items: T[]; total?: number }

const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '/api/v1'

export class ApiError extends Error {
  constructor(message: string, public status: number, public validation: ValidationError[] = []) { super(message) }
}

function messageFromDetail(detail: unknown): { message: string; validation: ValidationError[] } {
  if (typeof detail === 'string') return { message: detail, validation: [] }
  if (detail && typeof detail === 'object') {
    const object = detail as Record<string, unknown>
    const errors = Array.isArray(object.errors) ? object.errors : Array.isArray(object.detail) ? object.detail : []
    const validation = errors.map((entry) => {
      const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      return { row: typeof item.row === 'number' ? item.row : undefined, field: typeof item.field === 'string' ? item.field : undefined, message: String(item.message ?? item.msg ?? 'Invalid value') }
    })
    return { message: typeof object.message === 'string' ? object.message : validation.length ? 'Validation failed' : 'Request failed', validation }
  }
  return { message: 'Request failed', validation: [] }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      ...init,
    })
  } catch {
    throw new ApiError('Cannot reach the EvalBoard API. Check that the API service is running.', 0)
  }
  if (!response.ok) {
    let payload: unknown
    try { payload = await response.json() } catch { payload = null }
    const detail = payload && typeof payload === 'object' && 'detail' in payload ? (payload as { detail: unknown }).detail : payload
    const parsed = messageFromDetail(detail)
    throw new ApiError(parsed.message, response.status, parsed.validation)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function post<T>(path: string, body?: unknown): Promise<T> { return request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }) }

export const api = {
  health: () => request<Health>('/health'),
  me: async () => (await request<{ user: User }>('/auth/me')).user,
  login: (username: string, password: string) => post<{ user: User }>('/auth/login', { username, password }),
  logout: () => post<void>('/auth/logout'),
  datasets: () => request<ListResponse<Dataset>>('/datasets'),
  importDataset: (name: string, jsonl: string) => post<ImportResponse | Dataset>('/datasets/import', { name, jsonl }),
  cases: (datasetId: string, versionId: string) => request<ListResponse<EvalCase>>(`/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(versionId)}/cases`),
  editCase: (datasetId: string, versionId: string, caseId: string, editedCase: EvalCase) => post<{ version: DatasetVersion } | DatasetVersion>(`/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(versionId)}/cases/${encodeURIComponent(caseId)}/edit`, { case: editedCase }),
  targets: () => request<ListResponse<Target>>('/targets'),
  createTarget: (body: Record<string, unknown>) => post<Target>('/targets', body),
  configs: () => request<ListResponse<CandidateConfig>>('/configs'),
  createConfig: (body: Omit<CandidateConfig, 'id' | 'created_at'>) => post<CandidateConfig>('/configs', body),
  experiments: () => request<ListResponse<Experiment>>('/experiments'),
  createExperiment: (body: Record<string, unknown>) => post<Experiment>('/experiments', body),
  experiment: (id: string) => request<Experiment>(`/experiments/${encodeURIComponent(id)}`),
  experimentAction: (id: string, action: 'pause' | 'resume' | 'cancel') => post<Experiment>(`/experiments/${encodeURIComponent(id)}/${action}`),
  async results(id: string): Promise<ListResponse<CaseRun>> {
    const path = `/experiments/${encodeURIComponent(id)}/results`
    const first = await request<ListResponse<CaseRun>>(`${path}?limit=1000&offset=0`)
    const items = [...first.items]
    while (items.length < (first.total ?? items.length)) {
      const next = await request<ListResponse<CaseRun>>(`${path}?limit=1000&offset=${items.length}`)
      if (next.items.length === 0) break
      items.push(...next.items)
    }
    return { items, total: first.total }
  },
  eventHistory: (id: string) => request<ListResponse<ExperimentEvent>>(`/experiments/${encodeURIComponent(id)}/events/history`),
  comparison: (id: string) => request<Comparison>(`/experiments/${encodeURIComponent(id)}/comparison`),
  reviews: (experimentId?: string) => request<ListResponse<ReviewAssignment>>(`/reviews${experimentId ? `?experiment_id=${encodeURIComponent(experimentId)}` : ''}`),
  reviewDecision: (id: string, body: { label: 'left' | 'right' | 'tie' | 'both_bad'; score?: number; notes?: string }) => post<ReviewAssignment>(`/reviews/${encodeURIComponent(id)}/decision`, body),
  reviewAdjudicate: (id: string, body: { label: 'left' | 'right' | 'tie' | 'both_bad'; notes?: string }) => post<ReviewAssignment>(`/reviews/${encodeURIComponent(id)}/adjudicate`, body),
  gates: () => request<ListResponse<ReleaseGate>>('/gates'),
  createGate: (body: Record<string, unknown>) => post<ReleaseGate>('/gates', body),
  report: (id: string) => request<ReleaseReport>(`/experiments/${encodeURIComponent(id)}/report`),
  async downloadReport(id: string, format: 'json' | 'markdown') {
    const response = await fetch(`${base}/experiments/${encodeURIComponent(id)}/report/export?format=${format}`, { credentials: 'include' })
    if (!response.ok) throw new ApiError(`Report download failed (${response.status})`, response.status)
    const blob = await response.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `evalboard-report-${id}.${format === 'json' ? 'json' : 'md'}`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  },
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  return value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
}
export function formatMoney(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 4 : 2 }).format(value)
}
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
