# Evaluation workbench design — 2026-10-07

This bounded pass builds on [the prior upgrade](WORKBENCH_UPGRADE.md). It preserves the evaluation engine, existing local edits, URL discovery filters, editable scope presets, identity imports/exports, role restrictions, and release-report download behavior. All UI evidence uses a disposable synthetic workspace. No live AI benchmark, provider call, deployment, new credential, or package installation was performed.

## Product changes

- A compact evaluation console with a run ledger, execution progress, next operation, and latest gate evidence. The mobile ledger exposes state and inspection actions without sideways scrolling.
- A comparison matrix showing recorded A/B means, applicable sample counts, paired deltas, confidence intervals when recorded, and separate axes for each metric. Favorable/unfavorable labels respect the metric direction; absent evidence remains unavailable.
- A side inspector for recorded paired outputs or one failed attempt, with inputs, expandable references/context, original errors, applicable scores, latency/cost and trace events. The inspector supports repeated opening, Escape, keyboard focus containment/restoration, and theme switching while open. Inspection does not execute a model.
- Keyboard-navigable comparison tabs with arrows, Home/End, selected-tab focus, and labeled panels.
- Light, Dark and System modes across datasets, builders, runs, comparisons, reviews, reports, login, and appearance. Light and dark each have semantic surface/text/action/status/chart roles, including three accent palettes.

## Theme contract for client reuse

`evalboard.theme.v1` stores `light`, `dark`, or `system`. Fresh, corrupt, or inaccessible preference storage falls back to Dark. Explicit choices ignore OS changes; System listens for live changes and removes its listener when another mode is selected. Failed storage writes retain a working session selection with a visible message.

The same-origin blocking `public/theme-init.js` applies the stored preference before the application bundle. `public/theme-base.css` supplies initial canvas and native controls. The bootstrap works under `script-src 'self'` without inline script or relaxing CSP. The theme provider updates document attributes, rather than replacing the app tree, so it retains form drafts, URL filters, open evidence and query caches. Theme changes do not fetch evaluation data.

Theme settings are separate from the existing version-1 identity JSON; old brand/density/sidebar preferences and import files remain valid. Tokens live in `src/themes.css`. Mean plot axes, series and legends read those tokens; media is not inverted or recolored. JSON/Markdown report payloads remain API-owned. Print styles use a neutral light canvas and leave screen preference intact. See [client customization](CLIENT_CUSTOMIZATION.md).

## Local preview

From the project root, run the API in one PowerShell terminal:

```powershell
cd apps/api
$env:PYTHONPATH = 'src'
$env:DATABASE_URL = 'sqlite:///./evalboard-theme-demo.db'
$env:EVALBOARD_DEMO = '1'
$env:LANGSMITH_TRACING = 'false'
$env:OPENAI_API_KEY = ''
& .venv/Scripts/python.exe -m uvicorn evalboard.main:app --host 127.0.0.1 --port 8313
```

In a second terminal:

```powershell
cd apps/web
$env:VITE_API_PROXY_TARGET = 'http://127.0.0.1:8313'
node node_modules/vite/bin/vite.js --configLoader native --host 127.0.0.1 --port 4313 --strictPort
```

Open <http://127.0.0.1:4313>. The synthetic account filler appears on login. Existing completed histories support the full inspection demonstration. To execute a new bundled experiment, start `.venv/Scripts/python.exe -m evalboard.worker` from `apps/api` with the same database/environment as the API. Provider execution needs a separately approved server configuration.

The currently running local preview uses `.browser-tmp/theme-preview-20261007.db`. QA used `.browser-tmp/theme-qa.db` and a separate fresh `.browser-tmp/theme-final-qa-20261007.db`; original API databases were preserved. These ignored database/profile files are local verification data.

## Checks and evidence

From `apps/web`, reuse installed dependencies:

```powershell
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build --configLoader native
$env:EVALBOARD_OPENAPI_URL = 'http://127.0.0.1:8313/openapi.json'
node scripts/validate-openapi.mjs
$env:EVALBOARD_WEB_URL = 'http://127.0.0.1:4313'
node node_modules/@playwright/test/cli.js test --workers=1 --reporter=line --trace=off
```

The full suite passed **21/21** on a fresh synthetic QA database, covering nine new theme journeys, seven earlier workbench journeys, and five original workflows. After the final print-specific CSS correction, all **10/10 theme journeys** passed, including the new print test. Together these exercise 22 distinct cases. Core text/action/status token pairs meet a tested contrast ratio of at least 4.5:1 in both themes and all three palettes. This token check is not a claim of a complete accessibility certification.

The API contract check passed for **29 client operations and 7 request schemas**.

| Final check | Result |
| --- | --- |
| ESLint | Passed across the web project |
| TypeScript `--noEmit` | Passed |
| TypeScript `-b` | Passed |
| Vite production build | Latest Reports follow-up passed; 1,642 modules, 814 ms |
| JS bundle | 436.75 kB, gzip 127.47 kB |
| CSS bundle | 81.44 kB, gzip 16.46 kB |
| Full synthetic journeys | 21/21 passed in 28.6 s on a fresh database |
| Final theme/print journeys | 10/10 passed in 14.8 s after the last stylesheet change |
| Reports/header focused journeys | 7/7 passed in 21.9 s after the Reports correction |
| API contract | 29 operations, 7 request schemas passed |
| UI screenshots | 28 actual captures; both themes, four widths, zero page/console errors and zero horizontal page overflow |
| Final source hygiene | `git diff --check` and capture-script syntax check passed |

The first full run found one old assertion using an em dash for unavailable dataset counts; the previous display convention was restored. A repeat on an already-used database skipped the mutable reviewer assignment, so the full 21-case suite was rerun successfully on a new database. Print testing then exposed CSS precedence between the bootstrap canvas and print style; the corrected selector passed the final ten theme cases. No unresolved browser-test failure remains.

Capture actual screens from the project root:

```powershell
$env:EVALBOARD_URL = 'http://127.0.0.1:4313'
node scripts/capture_themes.cjs
```

Evidence is separate from the earlier images in `docs/screenshots/theme-workbench`. The capture uses an isolated headless instance of the **user's local Chrome**, without the normal user profile or shared interactive browser. It records 1440/1024/768/390 px layouts in both themes, paired and failed-case inspectors, mobile navigation, builder, dataset, review, report, and invalid appearance import. Fixed dialogs are captured at viewport size; normal pages use full-page captures. See [manifest](screenshots/theme-workbench/manifest.json).

No backend unit/graph suite, Docker/PostgreSQL deployment, live provider-quality evaluation or customer usability study was run in this frontend pass. The UI's synthetic labels remain visible. Theme preference is browser-local; account/workspace synchronization and custom uploaded logos/fonts are outside this pass.

## Bounded mobile API status follow-up

Independent visual QA found that the mobile connection text was hidden. `src/App.tsx` now supplies an explicit accessible status name, atomic live status semantics, and decorative icons; `src/themes.css` shows readable connection text in mobile headers and allows the breadcrumb to ellipsize when space is tight. Checking state uses its own status color as well as its text. Connected, checking and disconnected states can be understood without color.

The two focused journeys in `tests/e2e/mobile-header.spec.ts` passed in 3.6 s: visible text/accessible status in dark and light at 320/390 px, plus checking, disconnect and Retry recovery. The header itself has zero overflow at both widths. Latest ESLint, TypeScript `--noEmit`, TypeScript `-b`, and production build passed after the change. Local viewport evidence is `screenshots/theme-workbench/mobile-header-dark-320.png`, `mobile-header-dark-390.png`, and `mobile-header-light-390.png`; earlier committed screenshots remain intact.

The first focused run exposed an existing 50 px **Reports page** overflow at 320 px, unchanged when the new status text was hidden. The header follow-up preserved that separate layout; the bounded Reports correction below now resolves it. Overview and its header have zero document/header overflow at 320 px. The first test launch also found that the previous preview processes had stopped; restarting the assigned 4313/8313 preview resolved the environment timeout. No focused header test failure remains.

## Bounded Reports mobile layout correction

The Reports action row's unwrapped buttons increased the grid's natural track width to 354 px inside a 288 px container. The page now uses a flexible grid track and wraps those actions. The correction is scoped to `.report-page`; both metric tables retain their full 480 px width and horizontal scrolling inside their own regions. These named regions are focusable and support arrow-key scrolling, including access to the final column.

The latest **7/7 focused journeys passed in 21.9 s**: five new report cases plus the two header cases, whose coverage now also asserts zero Reports document overflow. Both dark/light themes at 320/390 px exercise table scrolling, every report control's horizontal bounds, repeated Gate dialog opening/focus restoration, experiment selection, saved JSON/Markdown downloads, and neutral print styling followed by restoration of the screen preference. JSON comparison and gate data match the saved API report. A simulated HTTP 503 export error remains within the page; clearing the error and repeating the export succeeds. No custom gate was saved and no live provider was called. The first report test run timed out on its label locator; using the control's verified accessible role/name corrected the test, with no product workaround needed.

Actual isolated captures in the user's local Chrome are recorded in [Reports evidence manifest](screenshots/theme-workbench/reports-mobile-manifest.json): `reports-dark-320.png`, `reports-light-320.png`, `reports-dark-390.png`, and `reports-light-390.png`. Every capture has zero document overflow and no page/console errors. The table regions are 248 px wide at 320 and 318 px at 390, with 480 px scrollable contents. Print captures are `reports-print-from-dark-390.png` and `reports-print-a4.png`; at the A4-equivalent width, both tables fit their 744 px regions with every column visible. An actual local A4 PDF was generated in the ignored `.browser-tmp/reports-mobile-print.pdf` for verification. New evidence remains local; previous committed screenshots are intact.

Focused verification from `apps/web` uses the existing preview above:

```powershell
$env:EVALBOARD_WEB_URL = 'http://127.0.0.1:4313'
node node_modules/@playwright/test/cli.js test tests/e2e/report-responsive.spec.ts tests/e2e/mobile-header.spec.ts --workers=1 --reporter=line --trace=off
```

The earlier full synthetic/theme suites were not repeated in this bounded layout correction. Backend, Docker/PostgreSQL, and live provider-quality checks remain outside the frontend scope.

Final ESLint, TypeScript `--noEmit`, TypeScript `-b`, production build, and `git diff --check` passed. The first non-elevated `-b` attempt could not write the existing ignored build-info file (EPERM); running the same command with the permissions used by previous checks resolved that environment issue. No compiler or lint error remains.

## Changed paths in this pass

| Area | Paths |
| --- | --- |
| Theme bootstrap/provider/control | `apps/web/index.html`, `public/theme-init.js`, `public/theme-base.css`, `src/components/ThemeProvider.tsx`, `ThemeControl.tsx`, `src/lib/theme.ts`, `useTheme.ts`, `src/main.tsx`, `src/App.tsx` |
| Semantic design | `apps/web/src/styles.css`, `themes.css`, `workbench.css`, `components/AppearanceProvider.tsx` |
| Workspace and evidence | `src/features/overview/OverviewPage.tsx`, `features/comparison/ComparisonPage.tsx`, `MetricMatrix.tsx`, `CaseEvidenceInspector.tsx`, `features/settings/SettingsPage.tsx` |
| Reports/mobile follow-up | `apps/web/src/features/reports/ReportPage.tsx`, `src/themes.css`, `src/App.tsx`, `tests/e2e/report-responsive.spec.ts`, `tests/e2e/mobile-header.spec.ts` |
| Verification | `apps/web/eslint.config.js`, `tests/e2e/themes.spec.ts`, `tests/e2e/workbench.spec.ts`, `scripts/capture_themes.cjs`, `docs/screenshots/theme-workbench/*` |
| Handoff | `README.md` (feature addition), `apps/web/README.md`, `docs/CLIENT_CUSTOMIZATION.md`, this record |
