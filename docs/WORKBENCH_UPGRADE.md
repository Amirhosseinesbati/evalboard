# Workbench upgrade · 2026-10-06

This pass preserves the existing FastAPI/worker evaluation pipeline and adds a task-oriented console experience for portfolio demonstrations and client reuse. All demonstrations remain clearly labeled as synthetic; no live provider call or model-quality benchmark was performed.

This is the historical first-pass record. The subsequent 2026-10-07 dark/light workbench, current verification and separate screenshots are documented in [THEME_WORKBENCH.md](THEME_WORKBENCH.md). The screenshot-upload status below describes the initial helper attempt, before later follow-up delivery.

## Delivered behavior

- **Overview:** real dataset case counts, experiment lifecycle counts, unresolved review assignments, latest report evidence, recent experiments, and an action based on the current workspace state. Failed API requests show unavailable counts and retry controls.
- **Experiment discovery:** name search, active/attention/review/completed/cancelled filters, split filters, newest/oldest ordering, persistent URL filters, and a useful no-match state.
- **Builder:** three editable scope presets and a readiness checklist; presets preserve the selected dataset and candidates.
- **Appearance:** browser-local brand name/tagline, three palettes, comfortable/compact rows, persisted sidebar state, deployment defaults, and validated JSON import/export. See [CLIENT_CUSTOMIZATION.md](CLIENT_CUSTOMIZATION.md).
- **Navigation:** Overview landing page, a working workflow guide, a skip link, and a mobile drawer with keyboard focus containment, Escape dismissal, focus restoration, and an inert background.

Existing local changes to the root README, `.gitignore`, and `teaser_assets` were retained. No sibling or shared project folders were edited. Existing dependency junctions pointing to the folder's previous name were relinked locally, without installing packages.

## Preview on the assigned ports

Use a separate synthetic database for verification. From the project root, start the API in one PowerShell terminal:

```powershell
cd apps/api
$env:PYTHONPATH = 'src'
$env:DATABASE_URL = 'sqlite:///./evalboard-workbench-demo.db'
$env:EVALBOARD_DEMO = '1'
$env:LANGSMITH_TRACING = 'false'
& .venv/Scripts/python.exe -m uvicorn evalboard.main:app --host 127.0.0.1 --port 8313
```

Start the worker in a second terminal using the same API directory and environment values:

```powershell
cd apps/api
$env:PYTHONPATH = 'src'
$env:DATABASE_URL = 'sqlite:///./evalboard-workbench-demo.db'
$env:EVALBOARD_DEMO = '1'
$env:LANGSMITH_TRACING = 'false'
& .venv/Scripts/python.exe -m evalboard.worker
```

Start the frontend in a third terminal:

```powershell
cd apps/web
$env:VITE_API_PROXY_TARGET = 'http://127.0.0.1:8313'
node node_modules/vite/bin/vite.js --configLoader native --host 127.0.0.1 --port 4313 --strictPort
```

Open <http://127.0.0.1:4313>. Use the synthetic demo credentials in [HANDOVER.md](HANDOVER.md). These commands reuse installed dependencies; use the root [README](../README.md) for initial dependency setup. Vite now fails clearly if a requested port is occupied.

## Repeatable checks

From `apps/web`:

```powershell
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build --configLoader native
$env:EVALBOARD_WEB_URL = 'http://127.0.0.1:4313'
node node_modules/@playwright/test/cli.js test --workers=1
```

The browser tests use an isolated context of the user's local Chrome. They do not use the user's normal profile or the shared interactive browser. Use a disposable synthetic database: the existing workflow suite creates a bundled experiment and submits a reviewer decision. The new workbench journeys test derived evidence, filter recovery/persistence, appearance preview/apply/reload/export/import, blocked storage, scope presets, API failure/retry, and mobile keyboard navigation.

From the project root, capture screenshots with the running synthetic preview:

```powershell
$env:EVALBOARD_URL = 'http://127.0.0.1:4313'
node scripts/capture_workbench.cjs
```

New screenshots and a provenance/overflow/error manifest are saved separately in `docs/screenshots/workbench`; the previous screenshots remain intact.

## Verification result

| Check | Result | Scope |
| --- | --- | --- |
| ESLint | Passed | Entire web project, including new journeys |
| TypeScript `--noEmit` | Passed | Web source and Vite configuration |
| API contract | Passed | 29 client operations and 7 request schemas against local API 8313 |
| New workbench journeys | 7 passed in 11.8 s | Overview evidence; URL filters; appearance preview/apply/persistence/export/import; blocked storage; presets and real create/cancel; API error/retry; mobile keyboard navigation |
| Existing workflow journeys | 5 passed in 9.6 s | Persisted cancellation; failed-case inspection; reviewer keyboard/role restriction; report export; modal keyboard focus |
| Screenshot inspection | Passed | Actual user's local Chrome, isolated headless context; 1440/1024/390 px; see [manifest](screenshots/workbench/manifest.json) |
| Production build | Passed | `tsc -b` followed by Vite 8.3.1; 1,635 modules; JS 428.40 kB (gzip 125.12 kB), CSS 62.52 kB (gzip 14.52 kB); Vite build completed in 1.05 s |
| Backend unit/graph suite, Docker/PostgreSQL, live provider | Not run in this pass | No backend source changed; no live quality claim |

The first new-journey run had 6 passes and a test-locator timeout: an exact `getByLabel` lookup did not match the required dataset label. The test now uses the actual accessible combobox name and verifies a complete create/cancel flow; all 7 passed on rerun. The first preview launch also hit sandbox write restrictions in Vite cache and SQLite temp files; project-local launches succeeded through the available approval reviewer. The first screenshot attempt hit an auth timeout; a later capture succeeded after health and login returned HTTP 200. No unresolved application or browser test failure remains.

Tests ran against `.browser-tmp/workbench-qa.db`. The final local preview uses a separate fresh `.browser-tmp/workbench-preview.db` so test-created runs do not clutter the portfolio demonstration. The existing API databases were preserved. An idle bundled-demo worker is available for the local preview. These files and temporary browser profiles are local ignored data, rather than shipped deliverables.

This record does not claim Docker, live provider quality, PostgreSQL deployment, or customer usability testing in this pass. Appearance remains browser-local; it does not synchronize themes across users/workspaces.

## Representative screenshot delivery

- Desktop: `docs/screenshots/workbench/overview-1440.png` (174,138 bytes).
- Mobile: `docs/screenshots/workbench/overview-390.png` (136,458 bytes).

## Changed paths

| Area | Paths |
| --- | --- |
| Shell and navigation | `apps/web/src/App.tsx`, `apps/web/src/main.tsx` |
| Overview | `apps/web/src/features/overview/OverviewPage.tsx` |
| Discovery and builder | `apps/web/src/features/experiments/ExperimentHistory.tsx`, `apps/web/src/features/experiments/ExperimentsPage.tsx` |
| Appearance | `apps/web/src/features/settings/SettingsPage.tsx`, `apps/web/src/components/AppearanceProvider.tsx`, `apps/web/src/lib/appearance.ts`, `apps/web/src/lib/useAppearance.ts`, `apps/web/src/workbench.css`, `apps/web/.env.example` |
| Local verification | `apps/web/vite.config.ts`, `apps/web/playwright.config.ts`, `apps/web/tests/e2e/workbench.spec.ts`, `scripts/capture_workbench.cjs` |
| Documentation and evidence | `README.md` (append-only feature section), `apps/web/README.md`, `docs/CLIENT_CUSTOMIZATION.md`, `docs/WORKBENCH_UPGRADE.md`, `docs/screenshots/workbench/*` |

The pre-existing `.gitignore` and `teaser_assets` modifications are outside this pass and remain intact.
