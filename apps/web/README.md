# EvalBoard web console

React 19, TypeScript, Vite 8, Tailwind CSS 4, and TanStack Query. The console reads and writes the FastAPI service at `/api/v1`; it contains no simulated success screens or hard-coded metric values.

## Local development

With the API running on `127.0.0.1:8010`:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to `127.0.0.1:8010`; set `VITE_API_PROXY_TARGET` if the API uses another host or port. `VITE_API_BASE_URL` can override the API prefix. The demo credential filler appears only when the API health endpoint reports demo mode, with `VITE_DEMO_MODE=true|1` as an offline fallback.

```powershell
pnpm lint
pnpm typecheck
pnpm build
pnpm check:api-contract
```

`check:api-contract` reads the live API OpenAPI document (default `http://127.0.0.1:8010/openapi.json`, override with `EVALBOARD_OPENAPI_URL`) and validates each endpoint used by the typed client plus required request fields. Run it after backend changes.

## Browser journeys

With the seeded demo API running, install a Playwright browser once and run:

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

The tests use the real demo API and cover cancellation, failed-case filtering, keyboard review, and report download. They create one experiment and submit one reviewer decision; use a fresh or reset demo database for repeatable runs. `EVALBOARD_WEB_URL` points tests at a different web origin, and `EVALBOARD_DEMO_PASSWORD` overrides the seeded password. The Playwright config starts or reuses Vite; it does not start the API or worker.

## Interfaces

- Datasets: JSONL import with row validation, case inspection and immutable editing.
- Experiments: target and candidate configuration forms, run limits and pinned release gate.
- Live run: persisted outcomes, pause/resume/cancel, SSE events with polling fallback.
- Comparison: metric matrix with applicable counts, paired deltas/intervals and independent-axis mean plots; paired/failure evidence inspector and keyboard-navigable configuration/failure tabs.
- Blinded review: left/right outputs, evidence, keyboard shortcuts and admin adjudication.
- Release report: task-specific deltas, gate failures, limitations and JSON/Markdown export.

The reviewer role is restricted to the review queue in both navigation and server access. Historical experiments and the demo workspace are explicitly labeled as synthetic.

## Workbench and client identity

The `/overview` landing page derives its counts, recent runs, next step, and latest report from the API. `/experiments` stores search, lifecycle, split, and sort filters in the URL. The experiment builder has editable scope presets and a readiness checklist.

`/appearance` previews/applies browser-local name, tagline, palette, density and sidebar preferences. It exports versioned display-only JSON and validates imports before applying them. Deployment defaults use `VITE_BRAND_NAME`, `VITE_BRAND_TAGLINE`, and `VITE_BRAND_ACCENT`. See [client customization](../../docs/CLIENT_CUSTOMIZATION.md) for the contract and limitations.

For the coordinated preview on `4313` (API `8313`), commands, repeatable checks, and screenshots are in [the upgrade record](../../docs/WORKBENCH_UPGRADE.md). `EVALBOARD_WEB_URL` now also controls the port started by the Playwright Vite server. `strictPort` prevents an occupied port from silently changing the preview URL.

The console now supports **Light / Dark / System**, with a dark default, browser persistence, live system changes, and a same-origin pre-paint bootstrap. Theme changes preserve drafts, filters, open inspectors and query caches. Semantic theme/status/chart tokens live in `src/themes.css`; `public/theme-init.js` and `public/theme-base.css` must be served with the app. See [the theme workbench record](../../docs/THEME_WORKBENCH.md) for this pass's checks and screenshots. `node ../../scripts/capture_themes.cjs` captures both themes using the user's local Chrome in an isolated headless context.
