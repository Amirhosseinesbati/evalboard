# Commercialization

## Intended buyer

A small AI product team with an existing assistant or extraction workflow that needs a repeatable release decision. The pilot is an installation and customization engagement: configure the target adapter, map the customer's task schema, define meaningful references and review rubric, then agree on a release gate.

## Onboarding sequence

1. Inventory the customer's task types, target endpoint, permitted data, and current release checks.
2. Deploy a customer-specific PostgreSQL instance, API, worker, and web client behind HTTPS; configure backups and retention.
3. Set admin/operator/viewer users, secret storage, target allowlist, budgets, and model pricing.
4. Import a small checked dataset, validate metric applicability, and review a blinded sample.
5. Run A/B experiments, inspect regressions, tune the gate, and sign off on a report format for CI.

## Reusable modules

Dataset versioning, target-adapter contract, evaluator plugins, durable case-run accounting, paired comparison, blinded review, and JSON report/CLI gate can be reused across products. New adapters and task-specific metrics require implementation and validation.

## Ongoing costs

Estimate monthly cost from **target tokens × configured provider price**, optional judge tokens × judge price, plus PostgreSQL storage/backup, compute for API and worker, and operator review time. Keep unknown prices as unknown. Quote usage caps and observed pilot volumes before promising a fixed total. The bundled demo uses deterministic local responses and does not incur model API fees.

## v1 boundaries

The pilot does not include self-service SaaS tenancy, billing, production traffic sampling, or every provider protocol. Live-model superiority requires a representative customer dataset and review; synthetic fixture results cannot establish it. A customer deployment also requires an environment-specific security and backup review.

## Redistribution and licenses

A preliminary 2026-09-28 metadata check of **direct** locked dependencies found MIT for most Python and web runtime libraries, BSD-3-Clause for `httpx`/`uvicorn`, Apache-2.0 for `python-multipart` and TypeScript, ISC for `lucide-react`, and LGPL-3.0-only for `psycopg`/`psycopg-binary` 3.3.6. The local favicon is a project-authored SVG; no external imagery or font was bundled. Before redistribution, include required license notices and review the `psycopg-binary` LGPL obligations for the actual package/container format. Transitive packages and base-image layers have **not** been audited; generate an SBOM and complete that review for a commercial delivery. This inventory is not legal clearance or a claim of rights in third-party assets.
