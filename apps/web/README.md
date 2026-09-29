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
- Comparison: applicable metric distributions, paired examples, failure explorer and configuration diff.
- Blinded review: left/right outputs, evidence, keyboard shortcuts and admin adjudication.
- Release report: task-specific deltas, gate failures, limitations and JSON/Markdown export.

The reviewer role is restricted to the review queue in both navigation and server access. Historical experiments and the demo workspace are explicitly labeled as synthetic.
