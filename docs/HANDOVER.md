# Handover

Updated: 2026-09-28. This is an independent local EvalBoard build from the supplied brief. The supplied folder had no Git repository; a local `main` repository was initialized for this delivery. Run `git rev-parse HEAD` in the project root to read the exact current commit. No customer data or live-model benchmark result is included.

## Launch

From the project root, after Docker Engine and Compose are available:

```sh
docker compose up --build
```

Open `http://localhost:5173`. The API is at `http://localhost:8010` and its OpenAPI page at `http://localhost:8010/docs`. The `init` service migrates and seeds only in demo mode. Both application images built successfully on Docker Desktop 4.49.0. A later `docker compose up -d --no-build --pull never` reached a healthy PostgreSQL service and a successful init migration and seed; full API/worker/web smoke is still pending because Docker's container metadata and log reads returned I/O errors. The database stays on the internal Compose network, with no host PostgreSQL port.

For a direct Windows demo, use three PowerShell terminals:

```powershell
cd 'apps/api'
uv sync --frozen
uv run --frozen uvicorn evalboard.main:app --host 127.0.0.1 --port 8010
```

```powershell
cd 'apps/api'
uv run --frozen python -m evalboard.worker
```

```powershell
cd 'apps/web'
pnpm install --frozen-lockfile
pnpm run dev
```

With no local `.env`, direct mode uses a local SQLite demo database and creates the synthetic seed. Run only one worker with SQLite. See [README.md](../README.md) for POSIX commands and [OPERATIONS.md](OPERATIONS.md) for customer PostgreSQL setup.

### Docker Desktop check on this host

The first Compose attempt was interrupted by Docker Desktop losing its Linux engine; its backend log reported an inaccessible internal `dockerInference` socket. The engine subsequently returned, and `docker compose up -d --no-build --pull never` reached `db` healthy and `init` exit 0. Alembic migration and synthetic seed both succeeded. The API started initially, but Docker then returned `input/output error` when reading logs, image data, and containerd metadata. A follow-up `docker compose build api` failed on containerd `meta.db` with the same I/O error, so that build did not verify an updated image. Host drive C: initially had about 0.01 GB free; 301 old temporary trace files were moved reversibly to a preserved local recovery directory, leaving about 5 GB free on C:. Docker's I/O error persisted. There were 25 containers from other projects, so no global restart or destructive Docker reset was performed. This project's Compose services were stopped, and the direct SQLite preview is the fallback while Docker storage is investigated.

After Docker's metadata store is healthy, rebuild sequentially from the current source, then run from this project root:

```sh
docker compose build api
docker compose build web
docker compose up -d --no-build --pull never
docker compose ps --all
docker compose logs init api worker web
```

The migration and seed have already been confirmed once. Confirm API/worker/web stay running, `/health` returns 200, and demo login plus report export work. Avoid a global engine reset while unrelated project containers are active; check Docker's storage/metadata fault first. The restored direct SQLite preview returned HTTP 200 for API `/health`, web `/`, and the web proxy `/api/v1/health`; admin login succeeded. The existing experiment `62283a81405e497d968e4f7a0407adad` still reported 240 pairs, six reviews, and gate `pass`, and its Markdown export returned HTTP 200 (2,732 bytes).

## Synthetic demo accounts

| Role | Workspace | Username | Password |
| --- | --- | --- | --- |
| Admin | Northstar demo | `admin@northstar.example.com` | `Demo123!` |
| Operator | Northstar demo | `operator@northstar.example.com` | `Demo123!` |
| Viewer | Northstar demo | `viewer@northstar.example.com` | `Demo123!` |
| Reviewer | Northstar demo | `reviewer@northstar.example.com` | `Demo123!` |
| Admin | Harbor demo | `admin@harbor.example.com` | `Demo123!` |

These are fictional demo accounts. Rotate their credentials and turn off demo mode before shared use.

The reviewer account can access only the blinded review queue and decisions. Admin/operator review is masked in the review interface but those roles can access unblinded experiment results elsewhere; use the reviewer role for independent blinded scores.

## Implemented / verified / pending

| Area | Implemented | Verified here | Pending |
| --- | --- | --- | --- |
| JSONL import/versioning | Yes | Parser accepted 5/5 valid rows; row 2 malformed and row 3 duplicate in invalid fixture. Backend integration tests passed HTTP import/edit and row errors. | Customer data validation |
| Full synthetic data | Yes | 240 unique cases, 80/160 split, 48 per task, hash `1c385bb4d14916d03b58e7aee1b926ff80845740961580745e6edae4646e3daa`; 30/30 references independently checked. | Representative customer data |
| API, worker, gate | Yes | Python 3.12.13 graph suite 15/15; four focused adapter checks passed; Ruff and mypy clean after final changes. Seeded 40-pair regression fails and repaired candidate passes in integration tests. Direct CLI gate exits were 1/0 for those fixtures and 0 for the full run. Isolated interrupted-graph run exited 2 (`incomplete`). | Docker/PostgreSQL smoke; fresh full suite after retention additions |
| Full paired workflow | Yes | One worker/concurrency 1: 480/480 case executions, 240/240 planned pairs, 0 failures, 0 regressions, 16 improvements; six blinded decisions completed and the [bundled fixture report](../evals/results/full_bundled_run_2026-09-28.json) passed. | Live-model quality |
| Web and API contract | Yes | Four one-worker Playwright journeys passed in 22.0 s, plus one focused modal-keyboard journey; 29 client operations and 7 request schemas checked against OpenAPI. Lint, type check and build passed. | Customer usability check |
| Visual QA | Yes | Eight real screenshots at 1440, 1024 and 390 px inspected; [manifest](screenshots/manifest.json) records zero console/page errors and zero horizontal overflow. | Customer branding |
| Connected model/HTTP | Yes | Adapters implemented; `OPENAI_API_KEY` absent. | Small bounded-cost live paired run |
| Retention and report export | Yes | Workspace-scoped content redaction core assertions passed against a temporary SQLite database. The live demo-database CLI dry run returned zero eligible pre-2020 experiments; apply without matching confirmation returned exit 2 and changed nothing. The live Markdown report export returned HTTP 200 with provenance and task evidence. Full pytest collection for the new retention tests did not finish on this host. | Customer retention policy and copied-data disposal |
| Docker Compose | Yes | `docker compose config --quiet` exited 0; locked API and web images built previously. A later no-build Compose run reached healthy PostgreSQL and `init` exit 0 with successful migration and seed. The API initially started, but Docker log/image/containerd metadata reads failed with `input/output error`; an API rebuild failed on containerd `meta.db`. Project containers were stopped. | Repair Docker's metadata I/O fault; then verify API, worker, web, login, report export and PostgreSQL backup/restore |

Machine-readable fixture results and direct CLI exit-code records are in [evals/results](../evals/results/). A process-level worker interruption test also passed: 50/80 case runs were complete before kill; recovery finished at 79/80 complete plus one uncertain in-flight call, zero duplicate score keys, and an `incomplete` gate. All quality claims require a separate representative experiment. See [EVALUATION.md](EVALUATION.md) for exact contracts and limits.

## Customer-specific next steps

Use PostgreSQL, rotate demo credentials, configure HTTPS with `SESSION_COOKIE_SECURE=true` and restricted network egress, set target allowlist and provider credentials, agree on retention/backups, validate a checked customer dataset, and define the release gate with reviewers. The checkpointed LangGraph experiment lifecycle covers bounded scheduling, case execution, aggregation, blinded-review interrupt/resume, and finalization; the SQL worker owns leases and crash recovery. Complete license notices/SBOM review before redistribution. Do not enable tracing or send customer data to a provider without customer approval.
