import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Cpu, Database, Layers3, Plus, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { api, formatMoney, formatNumber, type CandidateConfig, type User } from '../../lib/api'
import { ErrorState, Field, PageHeader, Tag } from '../../components/Primitives'

interface ConfigDraft { name: string; target_id: string; model_id: string; prompt: string; options: string; budget_usd: string; concurrency: string }
const initialConfig: ConfigDraft = { name: '', target_id: '', model_id: 'bundled:deterministic-v1', prompt: '', options: '{}', budget_usd: '1', concurrency: '2' }

function ConfigForm({ onCreated, onCancel }: { onCreated: (config: CandidateConfig) => void; onCancel: () => void }) {
  const targets = useQuery({ queryKey: ['targets'], queryFn: api.targets })
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ConfigDraft>(initialConfig)
  const [parseError, setParseError] = useState<string | null>(null)
  const create = useMutation({ mutationFn: (body: Omit<CandidateConfig, 'id' | 'created_at'>) => api.createConfig(body), onSuccess: (config) => { queryClient.invalidateQueries({ queryKey: ['configs'] }); onCreated(config) } })
  const update = (key: keyof ConfigDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const submit = (event: FormEvent) => { event.preventDefault(); try { const options: unknown = JSON.parse(draft.options); if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Options must be a JSON object'); setParseError(null); create.mutate({ name: draft.name.trim(), target_id: draft.target_id, model_id: draft.model_id.trim(), prompt: draft.prompt, options: options as Record<string, unknown>, budget_usd: draft.budget_usd ? Number(draft.budget_usd) : null, concurrency: Number(draft.concurrency) }) } catch (error) { setParseError(error instanceof Error ? error.message : 'Invalid options JSON') } }
  return <div className="inline-editor"><div className="section-heading"><div><h3>Save a candidate configuration</h3><p>Connected targets read credentials from the API or worker environment. Secret values never enter the browser.</p></div></div><form onSubmit={submit}><div className="form-grid"><Field label="Configuration name" required><input value={draft.name} onChange={(event) => update('name', event.target.value)} required placeholder="e.g. Return policy v2" /></Field><Field label="Target adapter" required><select value={draft.target_id} onChange={(event) => update('target_id', event.target.value)} required><option value="">Select a target</option>{targets.data?.items.map((target) => <option key={target.id} value={target.id}>{target.name} · {target.kind} · {target.connection_status?.replace(/_/g, ' ') ?? 'status unknown'}</option>)}</select></Field><Field label="Model ID" hint="Use the configured provider model ID or a fixture ID." required><input value={draft.model_id} onChange={(event) => update('model_id', event.target.value)} required /></Field><Field label="Concurrent calls" required><input type="number" min="1" max="8" value={draft.concurrency} onChange={(event) => update('concurrency', event.target.value)} required /></Field><Field label="Budget cap (USD)"><input type="number" min="0" step="0.01" value={draft.budget_usd} onChange={(event) => update('budget_usd', event.target.value)} /></Field><Field label="Retrieval and tool options (JSON)"><input className="mono-input" value={draft.options} onChange={(event) => update('options', event.target.value)} spellCheck={false} /></Field></div><Field label="System prompt"><textarea value={draft.prompt} onChange={(event) => update('prompt', event.target.value)} rows={5} placeholder="Instructions for the target agent…" /></Field>{targets.isError && <ErrorState compact error={targets.error} retry={() => targets.refetch()} />}{targets.data?.items.length === 0 && <p className="permission-note">No targets are configured. Add one below before saving a candidate.</p>}{parseError && <div className="inline-error" role="alert">{parseError}</div>}{create.isError && <ErrorState compact error={create.error} />}<div className="form-actions"><button className="btn btn-secondary" type="button" onClick={onCancel}>Cancel</button><button className="btn btn-primary" type="submit" disabled={create.isPending || !targets.data?.items.length}>{create.isPending ? 'Saving…' : 'Save configuration'}</button></div></form></div>
}

function TargetForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('bundled')
  const [endpoint, setEndpoint] = useState('')
  const [secretRef, setSecretRef] = useState('')
  const [recordedOutputs, setRecordedOutputs] = useState('{}')
  const [parseError, setParseError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const create = useMutation({ mutationFn: (recorded: Record<string, unknown> | null) => api.createTarget({ name: name.trim(), kind, endpoint: kind === 'http' ? endpoint || null : null, secret_ref: kind === 'http' ? secretRef || null : null, recorded_outputs: recorded }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['targets'] }); onClose() } })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (kind !== 'recorded') { create.mutate(null); return }
    try {
      const parsed: unknown = JSON.parse(recordedOutputs)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) throw new Error('Recorded outputs must be a non-empty case-keyed JSON object')
      setParseError(null)
      create.mutate(parsed as Record<string, unknown>)
    } catch (error) { setParseError(error instanceof Error ? error.message : 'Invalid JSON') }
  }
  return <div className="inline-editor">
    <div className="section-heading"><div><h3>Define a target adapter</h3><p>The bundled support agent works locally. Connected targets read credentials from the API or worker environment.</p></div></div>
    <form onSubmit={submit}>
      <div className="form-grid">
        <Field label="Target name" required><input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Support agent" /></Field>
        <Field label="Adapter type" required><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="bundled">Bundled agent</option><option value="http">Authenticated HTTP</option><option value="openai">OpenAI model</option><option value="recorded">Recorded run import</option></select></Field>
        {kind === 'http' && <Field label="HTTPS endpoint" required><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} required type="url" placeholder="https://service.example.com/evaluate" /></Field>}
        {kind === 'http' && <Field label="Secret reference" hint="Set this EVALBOARD_TARGET_* environment variable on the API and worker services."><input value={secretRef} onChange={(event) => setSecretRef(event.target.value)} pattern="EVALBOARD_TARGET_[A-Z0-9_]{1,100}" placeholder="EVALBOARD_TARGET_SUPPORT_TOKEN" /></Field>}
      </div>
      {kind === 'openai' && <p className="permission-note">Set <code>OPENAI_API_KEY</code> in the API and worker environments before running an OpenAI target. The key is never entered here; choose the model ID in a candidate configuration.</p>}
      {kind === 'recorded' && <Field label="Recorded outputs by case key" hint="JSON object mapping case keys to saved responses" required><textarea className="code-input" value={recordedOutputs} onChange={(event) => setRecordedOutputs(event.target.value)} rows={6} spellCheck={false} /></Field>}
      {parseError && <div className="inline-error" role="alert">{parseError}</div>}
      {create.isError && <ErrorState compact error={create.error} />}
      <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add target'}</button></div>
    </form>
  </div>
}

export function ExperimentBuilderPage({ user }: { user: User }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const datasets = useQuery({ queryKey: ['datasets'], queryFn: api.datasets })
  const configs = useQuery({ queryKey: ['configs'], queryFn: api.configs })
  const gates = useQuery({ queryKey: ['gates'], queryFn: api.gates })
  const [name, setName] = useState('')
  const [datasetId, setDatasetId] = useState(searchParams.get('dataset') ?? '')
  const [configA, setConfigA] = useState('')
  const [configB, setConfigB] = useState('')
  const [split, setSplit] = useState('development')
  const [maxCases, setMaxCases] = useState('')
  const [repetitions, setRepetitions] = useState('1')
  const [budget, setBudget] = useState('2')
  const [gateId, setGateId] = useState('')
  const [presetMessage, setPresetMessage] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [showTarget, setShowTarget] = useState(false)
  const create = useMutation({ mutationFn: (body: Record<string, unknown>) => api.createExperiment(body), onSuccess: (experiment) => { queryClient.invalidateQueries({ queryKey: ['experiments'] }); navigate(`/experiments/${experiment.id}`) } })
  const selectedDataset = datasets.data?.items.find((item) => item.id === datasetId)
  const configList = configs.data?.items ?? []
  const selectedA = configList.find((item) => item.id === configA)
  const selectedB = configList.find((item) => item.id === configB)
  const canCreate = user.role !== 'viewer' && Boolean(name.trim() && selectedDataset?.latest_version_id && selectedA && selectedB && configA !== configB)
  const applyPreset = (preset: 'smoke' | 'release' | 'repeat') => {
    setSplit(preset === 'release' ? 'held_out' : 'development')
    setMaxCases(preset === 'release' ? '' : '20')
    setRepetitions(preset === 'repeat' ? '3' : '1')
    setBudget(preset === 'smoke' ? '1' : '2')
    setPresetMessage(preset === 'smoke' ? 'Quick check scope applied.' : preset === 'release' ? 'Held-out release scope applied.' : 'Repeated check scope applied.')
  }
  const submit = (event: FormEvent) => { event.preventDefault(); if (!canCreate) return; create.mutate({ name: name.trim(), dataset_version_id: selectedDataset!.latest_version_id, candidate_a_id: configA, candidate_b_id: configB, split, max_cases: maxCases ? Number(maxCases) : null, repetitions: Number(repetitions), budget_usd: budget ? Number(budget) : null, gate_id: gateId || null }) }
  return <div className="stack-page"><Link to="/experiments" className="back-link"><ArrowLeft size={16} /> All experiments</Link><PageHeader eyebrow="EXPERIMENT BUILDER" title="Set up a paired run" description="Pin one dataset version and compare two configurations on identical cases." /><section className="panel"><div className="section-heading"><div><h2>Start with a run scope</h2><p>Choose a starting point, then adjust the limits below. Your dataset and candidates stay selected.</p></div></div><div className="preset-grid">
    <button className="run-preset" type="button" disabled={user.role === 'viewer'} onClick={() => applyPreset('smoke')}><Cpu size={20} /><strong>Quick check</strong><span>A small development sample to check your setup.</span><small>Up to 20 cases · 1 repeat · $1 cap</small></button>
    <button className="run-preset" type="button" disabled={user.role === 'viewer'} onClick={() => applyPreset('release')}><ShieldCheck size={20} /><strong>Release comparison</strong><span>Compare the full held-out split with your pinned gate.</span><small>Held-out cases · 1 repeat · $2 cap</small></button>
    <button className="run-preset" type="button" disabled={user.role === 'viewer'} onClick={() => applyPreset('repeat')}><Layers3 size={20} /><strong>Repeated check</strong><span>Repeat a development sample to inspect variation.</span><small>Up to 20 cases · 3 repeats · $2 cap</small></button>
    </div><p className="preset-note">Scope presets are editable limits, not a guarantee of statistical power or provider spend.</p>{presetMessage && <p className="appearance-feedback" role="status">{presetMessage}</p>}</section><div className="builder-layout"><form className="builder-main" onSubmit={submit}><section className="panel"><div className="step-heading"><span>01</span><div><h2>Run definition</h2><p>Name the run and select the fixed case snapshot.</p></div></div><div className="form-grid"><Field label="Experiment name" required><input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Return policy prompt comparison" /></Field><Field label="Dataset" required><select value={datasetId} onChange={(event) => setDatasetId(event.target.value)} required><option value="">Select dataset</option>{datasets.data?.items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.case_count} cases</option>)}</select></Field></div>{selectedDataset && <div className="selected-version"><Database size={16} /><span>Version <code>{selectedDataset.latest_version_id}</code> · {selectedDataset.case_count} cases</span><Tag tone="cyan">Pinned</Tag></div>}{datasets.isError && <ErrorState error={datasets.error} compact retry={() => datasets.refetch()} />}</section><section className="panel"><div className="step-heading"><span>02</span><div><h2>Candidate configurations</h2><p>Use the same target or test a different adapter. A and B must be distinct saved configurations.</p></div></div><div className="candidate-grid"><div className="candidate-panel"><div className="candidate-head"><span className="candidate-letter">A</span><strong>Baseline</strong></div><Field label="Configuration" required><select value={configA} onChange={(event) => setConfigA(event.target.value)} required><option value="">Select baseline</option>{configList.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>{selectedA && <ConfigSummary config={selectedA} />}</div><div className="candidate-panel candidate-b"><div className="candidate-head"><span className="candidate-letter">B</span><strong>Challenger</strong></div><Field label="Configuration" required><select value={configB} onChange={(event) => setConfigB(event.target.value)} required><option value="">Select challenger</option>{configList.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>{selectedB && <ConfigSummary config={selectedB} />}</div></div>{configA && configA === configB && <div className="inline-error" role="alert">Choose two different configurations.</div>}<div className="inline-actions"><button className="text-button" type="button" onClick={() => { setShowConfig(!showConfig); setShowTarget(false) }}><Plus size={15} /> New configuration</button><button className="text-button" type="button" onClick={() => { setShowTarget(!showTarget); setShowConfig(false) }}><Plus size={15} /> New target adapter</button></div>{configs.isError && <ErrorState compact error={configs.error} retry={() => configs.refetch()} />}{showConfig && <ConfigForm onCancel={() => setShowConfig(false)} onCreated={(config) => { if (!configA) setConfigA(config.id); else setConfigB(config.id); setShowConfig(false) }} />}{showTarget && <TargetForm onClose={() => setShowTarget(false)} />}</section><section className="panel"><div className="step-heading"><span>03</span><div><h2>Limits and scope</h2><p>Budget exhaustion stops scheduling new case calls. Failed cases still count.</p></div></div><div className="form-grid three"><Field label="Case split" required><select value={split} onChange={(event) => setSplit(event.target.value)}><option value="development">Development</option><option value="held_out">Held out</option><option value="all">All cases</option></select></Field><Field label="Max cases" hint="Blank runs the full split"><input type="number" min="1" max="240" value={maxCases} onChange={(event) => setMaxCases(event.target.value)} placeholder="All cases" /></Field><Field label="Repetitions" required><input type="number" min="1" max="5" value={repetitions} onChange={(event) => setRepetitions(event.target.value)} required /></Field><Field label="Experiment budget (USD)" required><input type="number" min="0" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} required /></Field><Field label="Release gate" hint="Pinned with the experiment; default no-regression gate if omitted"><select value={gateId} onChange={(event) => setGateId(event.target.value)}><option value="">Default no-regression gate</option>{gates.data?.items.map((gate) => <option key={gate.id} value={gate.id}>{gate.name}</option>)}</select></Field></div>{gates.isError && <ErrorState compact error={gates.error} retry={() => gates.refetch()} />}</section>{create.isError && <ErrorState error={create.error} compact />}<div className="form-actions builder-submit"><Link to="/experiments" className="btn btn-secondary">Cancel</Link><button className="btn btn-primary" disabled={!canCreate || create.isPending} type="submit">{create.isPending ? 'Creating experiment…' : 'Start paired experiment'} <ArrowRight size={17} /></button></div>{user.role === 'viewer' && <p className="permission-note">Viewer access cannot start experiments. Ask an operator or admin.</p>}</form><aside className="builder-aside"><div className="aside-card"><div className="eyebrow">RUN READINESS</div><h3>Before you start</h3><ul className="builder-checklist">{[
      { label: 'A named experiment', ready: Boolean(name.trim()) },
      { label: 'A versioned dataset', ready: Boolean(selectedDataset?.latest_version_id) },
      { label: 'Two distinct candidates', ready: Boolean(selectedA && selectedB && configA !== configB) },
      { label: 'An explicit budget cap', ready: budget !== '' && Number.isFinite(Number(budget)) && Number(budget) >= 0 },
    ].map(item => <li key={item.label} className={item.ready ? 'ready' : ''}>{item.ready ? <CheckCircle2 size={15} /> : <Circle size={15} />}{item.label}</li>)}</ul></div><div className="aside-card"><div className="aside-icon"><SlidersHorizontal size={18} /></div><h3>What happens next</h3><ol><li>Validate the dataset and configs</li><li>Schedule bounded case batches</li><li>Persist target output before scoring</li><li>Compare pairs and inspect regressions</li><li>Review a blinded sample</li><li>Generate the release decision</li></ol></div><div className="aside-card muted-card"><Cpu size={20} /><strong>Target responses</strong><p>Bundled fixture responses and seeded historical experiments are clearly labeled as simulated. Connected provider calls require configured credentials.</p></div></aside></div></div>
}

function ConfigSummary({ config }: { config: CandidateConfig }) {
  const entries = useMemo(() => [ ['Model', config.model_id], ['Budget', formatMoney(config.budget_usd)], ['Concurrency', formatNumber(config.concurrency)] ], [config])
  return <dl className="config-summary">{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}
