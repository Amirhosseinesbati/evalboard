import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Activity, ArrowUpRight, BarChart3, BookOpenText, CheckCircle2, CircleHelp, Database, FileChartColumn, FlaskConical, GitCompareArrows, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck, WifiOff, X } from 'lucide-react'
import { api, ApiError, type User } from './lib/api'
import { ErrorState, LoadingState } from './components/Primitives'
import { DatasetsPage, DatasetDetailPage } from './features/datasets/DatasetsPage'
import { ExperimentBuilderPage, ExperimentsPage } from './features/experiments/ExperimentsPage'
import { RunPage } from './features/experiments/RunPage'
import { ComparisonPage } from './features/comparison/ComparisonPage'
import { ReviewsPage } from './features/reviews/ReviewsPage'
import { ReportPage } from './features/reports/ReportPage'

const navigation = [
  { to: '/datasets', label: 'Datasets', icon: Database },
  { to: '/experiments', label: 'Experiments', icon: FlaskConical },
  { to: '/compare', label: 'Comparisons', icon: GitCompareArrows },
  { to: '/reviews', label: 'Review queue', icon: BookOpenText },
  { to: '/reports', label: 'Release reports', icon: FileChartColumn },
]

function LoginPage() {
  const queryClient = useQueryClient()
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const login = useMutation({ mutationFn: () => api.login(username, password), onSuccess: ({ user }) => queryClient.setQueryData(['me'], user) })
  const demoFlag = ['true', '1'].includes(import.meta.env.VITE_DEMO_MODE ?? '')
  const demo = health.data ? health.data.mode === 'demo' : demoFlag
  const submit = (event: FormEvent) => { event.preventDefault(); login.mutate() }
  return <div className="login-page">
    <aside className="login-story"><div className="brand"><span className="brand-mark"><Activity size={23} strokeWidth={2.5} /></span><span>EvalBoard</span></div><div className="login-story-main"><div className="eyebrow light">AI EVALUATION WORKBENCH</div><h1>Evidence before<br /><em>release.</em></h1><p>Run paired experiments, find the regressions that matter, and ship with a decision you can reproduce.</p><div className="login-proof"><span><GitCompareArrows size={18} /> Paired cases</span><span><ShieldCheck size={18} /> Blinded review</span><span><BarChart3 size={18} /> Release gates</span></div></div><div className="login-story-foot">A precise console for small AI product teams.</div></aside>
    <main className="login-main"><div className="login-card"><div className="login-kicker">WORKSPACE ACCESS</div><h2>Sign in to EvalBoard</h2><p>Use your workspace account to inspect datasets and experiments.</p><form onSubmit={submit}><label className="field"><span className="field-label">Email or username</span><input autoComplete="username" autoFocus required type="text" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="name@company.com" /></label><label className="field"><span className="field-label">Password</span><input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /></label>{login.isError && <ErrorState compact error={login.error} />}<button className="btn btn-primary btn-full" type="submit" disabled={login.isPending}>{login.isPending ? 'Signing in…' : 'Sign in'} <ArrowUpRight size={17} /></button></form>{demo && <div className="demo-login"><span>Synthetic demo workspace</span><button type="button" onClick={() => { setUsername('admin@northstar.example.com'); setPassword('Demo123!') }}>Fill demo credentials</button></div>}</div></main>
  </div>
}

function AppShell({ user }: { user: User }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const queryClient = useQueryClient()
  const [logoutError, setLogoutError] = useState<unknown>(null)
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { queryClient.clear(); window.location.assign('/login') }, onError: (error) => setLogoutError(error) })
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30_000, retry: false })
  const disconnected = health.error instanceof ApiError && health.error.status === 0
  const connectionLabel = disconnected ? 'API disconnected' : health.isFetching ? 'Checking connection' : health.isError ? 'API error' : 'API connected'
  const demo = health.data?.mode === 'demo'
  const visibleNavigation = user.role === 'reviewer' ? navigation.filter((item) => item.to === '/reviews') : navigation
  const homePath = user.role === 'reviewer' ? '/reviews' : '/datasets'

  return <div className={`app-frame ${collapsed ? 'rail-collapsed' : ''}`}>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`side-rail ${mobileOpen ? 'open' : ''}`} aria-label="Main navigation">
      <div className="rail-top"><NavLink className="brand" to={homePath} onClick={() => setMobileOpen(false)}><span className="brand-mark"><Activity size={22} strokeWidth={2.5} /></span><span className="brand-name">EvalBoard</span></NavLink><button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={20} /></button></div>
      <div className="rail-space"><div className="rail-caption">WORKSPACE</div><nav className="rail-nav">{visibleNavigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setMobileOpen(false)} className={({ isActive }) => `rail-link ${isActive || (to === '/experiments' && location.pathname.startsWith('/experiments/')) ? 'active' : ''}`} title={label}><Icon size={18} strokeWidth={1.8} /><span>{label}</span></NavLink>)}</nav><div className="rail-divider" /><div className="rail-caption">CURRENT CONTEXT</div><div className="rail-context"><div className="rail-context-icon"><CheckCircle2 size={16} /></div><div><strong>{user.workspace_name}</strong><span>{demo ? 'Synthetic demo workspace' : health.data?.mode === 'connected' ? 'Connected workspace' : 'Workspace access'}</span></div></div></div>
      <div className="rail-bottom"><div className="rail-user"><div className="avatar">{user.username.charAt(0).toUpperCase()}</div><div className="rail-user-details"><strong>{user.username}</strong><span>{user.role} · workspace access</span></div></div><button className="rail-link rail-logout" type="button" onClick={() => logout.mutate()} disabled={logout.isPending} title="Sign out"><LogOut size={18} /><span>Sign out</span></button><button className="rail-collapse" type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
    </aside>
    <div className="main-frame"><div className="topbar"><button className="icon-button mobile-menu" type="button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={22} /></button><div className="topbar-breadcrumb"><span>WORKSPACE</span><span className="slash">/</span><strong>{navigation.find((item) => location.pathname.startsWith(item.to))?.label ?? 'Overview'}</strong></div><div className="topbar-right"><div className={`connection ${health.isError ? 'offline' : health.isFetching ? 'checking' : 'online'}`} role="status">{health.isError ? <WifiOff size={14} /> : <i />}<span>{connectionLabel}</span></div><div className="topbar-help" title="Case evidence and dataset source are labeled in each workflow"><CircleHelp size={18} /></div></div></div>{health.isError && <div className="connection-banner" role="alert">{connectionLabel}. Current data may be stale. <button type="button" onClick={() => health.refetch()}>Retry connection</button></div>}{logoutError != null && <div className="connection-banner" role="alert">Sign out failed. <button type="button" onClick={() => logout.mutate()}>Retry sign out</button></div>}
      <main className="page-content">{user.role === 'reviewer' ? <Routes><Route path="/reviews" element={<ReviewsPage user={user} />} /><Route path="*" element={<Navigate to="/reviews" replace />} /></Routes> : <Routes>
        <Route path="/" element={<Navigate to="/datasets" replace />} /><Route path="/login" element={<Navigate to="/datasets" replace />} />
        <Route path="/datasets" element={<DatasetsPage user={user} />} /><Route path="/datasets/:datasetId" element={<DatasetDetailPage user={user} />} />
        <Route path="/experiments" element={<ExperimentsPage user={user} />} /><Route path="/experiments/new" element={<ExperimentBuilderPage user={user} />} /><Route path="/experiments/:experimentId" element={<RunPage user={user} />} />
        <Route path="/compare" element={<ComparisonPage />} /><Route path="/compare/:experimentId" element={<ComparisonPage />} />
        <Route path="/reviews" element={<ReviewsPage user={user} />} />
        <Route path="/reports" element={<ReportPage user={user} />} /><Route path="/reports/:experimentId" element={<ReportPage user={user} />} />
        <Route path="*" element={<div className="empty-state"><h2>Page not found</h2><NavLink to="/datasets" className="btn btn-primary">Back to datasets</NavLink></div>} />
      </Routes>}</main>
    </div>
  </div>
}

export default function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false, staleTime: 60_000 })
  if (me.isPending) return <div className="boot-screen"><div className="brand"><span className="brand-mark"><Activity size={22} /></span>EvalBoard</div><LoadingState label="Connecting to workspace" /></div>
  if (me.error instanceof ApiError && me.error.status === 401) return <LoginPage />
  if (me.isError) return <div className="boot-screen"><div className="brand"><span className="brand-mark"><Activity size={22} /></span>EvalBoard</div><ErrorState error={me.error} retry={() => me.refetch()} /></div>
  return <AppShell user={me.data} />
}
