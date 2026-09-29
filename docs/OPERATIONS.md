# Operations

## Launch and health

The documented demo command is `docker compose up --build` from the project root. Compose starts PostgreSQL, runs the Alembic migration and idempotent synthetic seed, then starts API, worker, and web. Check `GET /health` and `GET /api/v1/health`, then sign in through the web client. The worker needs its own process; an API-only deployment can accept requests but cannot advance queued experiments.

The direct local mode in the README uses SQLite to demonstrate one-machine behavior. Customer installations should use PostgreSQL, a durable volume, one or more supervised workers, HTTPS at a trusted reverse proxy, and `SESSION_COOKIE_SECURE=true`. Sessions use random opaque database-backed tokens. Keep the web and API on the same trusted origin or configure narrowly scoped CORS and cookie settings.

### Docker Desktop I/O fault on this host

The locked images were built earlier. A subsequent `docker compose up -d --no-build --pull never` reached healthy PostgreSQL, and `init` exited 0 after Alembic migration and demo seed. The API initially started, but reads of Docker logs, image data, and containerd metadata then returned `input/output error`; `docker compose build api` also failed on containerd `meta.db`. C: free space was increased from about 0.01 GB to about 5 GB by moving old temporary trace files to a reversible location, but Docker's error persisted. With 25 unrelated containers active, this project's services were stopped and no global Docker restart or reset was attempted.

Treat this as a Docker storage/metadata incident, not an application migration failure. Once the engine can read container metadata reliably, rebuild API and web images from current source, inspect `docker compose ps --all` and `docker compose logs init api worker web`, then confirm `/health`, web login, worker progress, and report export. Preserve the existing Docker data and unrelated project containers while diagnosing the host fault. The direct SQLite preview is the verified fallback until container smoke is complete: API `/health`, web `/`, and proxied `/api/v1/health` returned HTTP 200; admin login, the 240-pair/six-review `pass` report, and a 2,732-byte Markdown export also succeeded.

## Backup and restore smoke test

Pause new experiments and take a consistent PostgreSQL backup with `pg_dump -Fc`. Keep the backup encrypted and access-restricted, with a retention period agreed for the customer. Restore into a separate test database with `pg_restore`, apply migrations, then verify row counts, a representative report export, and workspace isolation before treating the backup as usable. Back up any future external artifact storage together with its database references. Never test restore by overwriting the only live database.

Example inside the Compose database container:

```sh
pg_dump -U evalboard -Fc -f /tmp/evalboard.dump evalboard
createdb -U evalboard evalboard_restore_check
pg_restore -U evalboard -d evalboard_restore_check /tmp/evalboard.dump
psql -U evalboard -d evalboard_restore_check -c 'SELECT COUNT(*) FROM experiments;'
```

The operator must copy the dump to managed backup storage; `/tmp` inside a container is only a smoke-test location.

## Worker recovery and retries

Runs have persistent status and per-case keys. A worker claims bounded work, records the target output, and scores it separately. If a worker stops, restart it and inspect expired claims and any uncertain external attempts before retrying. A provider timeout may mean the remote call completed; do not blindly reissue a side effect. The bundled simulator is read-only. Do not reset or reseed a customer namespace while recovering a run.

## Connected target setup

Configure model IDs, prices, budgets, and credentials server-side. The worker reserves estimated maximum token cost before each connected call and enforces experiment and candidate caps, but a provider may bill overhead outside reported token usage; treat the cap as conservative scheduling control, not a guaranteed invoice ceiling. For an HTTP target, add only explicit trusted hosts to `HTTP_TARGET_ALLOWLIST`, require authentication, and avoid targets on private or local networks unless the deployment operator deliberately controls that network path. Verify a small request and its error path before a larger run. `OPENAI_API_KEY` is optional; absence leaves real-model verification pending. Keep LangSmith tracing disabled unless the customer explicitly configures it and approves what data may be sent.

## Customer configuration and retention

Create a customer-specific admin account and rotate the demo passwords before shared use. Set the workspace name, retention period, report export destination, allowed target hosts, per-run budget, and provider credentials. Define who may review and who may change gates. Review database and log retention together because logs can expose input text if configured carelessly.

### Workspace-scoped content redaction

Run the local CLI with database access after choosing a customer-approved cutoff. The command is a **dry run by default**; its JSON lists eligible experiment IDs and content counts. The cutoff must be an ISO-8601 timestamp with an explicit timezone, and cannot be in the future. Obtain the exact workspace ID from `user.workspace_id` in the authenticated `/api/v1/auth/me` response. Review a backup and the dry-run list before applying. For example, from the repository root in PowerShell:

```powershell
$env:PYTHONPATH = 'apps/api/src'
apps/api/.venv/Scripts/python.exe -m evalboard.cli redact --workspace-id '<workspace-id>' --before '2026-01-01T00:00:00Z'
apps/api/.venv/Scripts/python.exe -m evalboard.cli redact --workspace-id '<workspace-id>' --before '2026-01-01T00:00:00Z' --apply --confirm-workspace-id '<workspace-id>'
```

The POSIX equivalent uses `PYTHONPATH=apps/api/src python -m evalboard.cli redact ...`. The second command requires `--apply` and an exact repeated workspace ID. Run it only against the intended customer database; verification tests use a separate temporary SQLite database. Repeating it skips experiments already marked as redacted.

Only `completed` or `cancelled` experiments with terminal case runs, no active job, and last recorded activity **before** the cutoff are eligible. The last activity includes run completion, local events, reviews, and artifacts. A record without a reliable completion/cancellation time is excluded. `review_pending`, queued, paused, running, and newer experiments are excluded.

The operation clears case-run output JSON and error text, experiment failure text, review notes, adjudication notes, score detail JSON, event kinds/payloads, and existing artifact bodies. It preserves experiment/run/review statuses, numeric scores and costs, counts, case/review links, timestamps, and a per-experiment audit artifact containing only cutoff, time, and redaction counts. Reports can still compute the recorded gate decision, but cannot reconstruct candidate outputs or trace evidence. Immutable dataset input, expected answers, context, target recorded outputs, configuration prompts, experiment names, application logs, backups, and external traces are **not** changed. Handle those separately under the customer retention policy; this command is content redaction, not complete erasure. There is no automatic retention scheduler in v1.
