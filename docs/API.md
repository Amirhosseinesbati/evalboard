# API and automation contract

The JSON API is versioned under `/api/v1`. OpenAPI is served at `/openapi.json` and an interactive reference at `/docs`. `GET /health` and `GET /api/v1/health` provide health checks. Browser requests use an HTTP-only session cookie; clients must keep it across calls. Every resource operation checks the signed-in user's workspace and role. A restricted reviewer session can use only authentication and blinded review routes. List responses use `{ "items": [...] }`.

## Main resources

| Resource | Operations |
| --- | --- |
| Authentication | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` |
| Datasets | `GET /datasets`, `POST /datasets/import`, `POST /datasets/import/file`, `GET /datasets/{id}`, `GET /datasets/{id}/versions`, `GET /datasets/{id}/versions/{version_id}/cases`, `POST /datasets/{id}/versions/{version_id}/cases/{case_id}/edit` |
| Targets and configs | `GET/POST /targets`, `GET/POST /configs`, `GET /metrics` |
| Experiments | `GET/POST /experiments`, `GET /experiments/{id}`, `POST /experiments/{id}/pause`, `/resume`, `/cancel`, `GET /experiments/{id}/results`, `/comparison`, `/events/history`, `/events` |
| Reviews | `GET /reviews`, `POST /reviews/{id}/decision`, `POST /reviews/{id}/adjudicate` |
| Release | `GET/POST /gates`, `GET /experiments/{id}/report`, `GET /experiments/{id}/report/export?format=json\|markdown` |

Append `/api/v1` to each path in the table. The `/events` stream uses SSE; `/events/history` returns persisted observable events. It does not expose private model reasoning.

## Dataset JSONL

Each nonblank row has a stable `case_key`, `task_type` (`grounded_qa`, `tool_use`, `structured_extraction`, `abstention`, or `adversarial`), `split` (`development` or `held_out`), an `input` object, an `expected` object, optional `context`, and `tags`. See `evals/datasets/known_answer.jsonl` for examples.

Import request:

```json
{"name":"Support checks","description":"Reviewed pilot cases","jsonl":"{...one case...}\n{...next case...}"}
```

Malformed rows and duplicate keys return row-numbered errors. Editing a case uses `{ "case": <complete case payload> }` and creates a new immutable version; experiments keep their original version ID. Query cases by `split` or `task_type` when needed.

## Experiment and report

An experiment request selects one dataset version and two saved configuration IDs:

```json
{
  "name": "Return policy candidate",
  "dataset_version_id": "<id>",
  "candidate_a_id": "<id>",
  "candidate_b_id": "<id>",
  "split": "development",
  "max_cases": 40,
  "repetitions": 1,
  "budget_usd": 1.0,
  "gate_id": "<optional-id>"
}
```

Each case run has a persisted status, output or error, queue wait, inference latency, known/unknown token usage and cost, and task-applicable scores. A timeout or failure remains in the paired denominator. `GET /experiments/{id}/comparison` returns metric-specific means/counts/deltas, paired examples, and configuration differences. `GET /experiments/{id}/report` includes `version: "1.0"`, source (`bundled_fixture`, `recorded_import`, `connected`, `mixed`, or `simulated_history`), gate thresholds/failures, decision (`pass`, `fail`, or `incomplete`), counts, task-primary A/B success numerators, dataset hash, selected case IDs, evaluator version, review summary, limitations, and a timestamp. A report is incomplete while work or required review is pending.

`GET /experiments/{id}/report/export?format=markdown` renders the same release evidence in a readable file: provenance, coverage, gate thresholds and failures, task-specific A/B counts and paired intervals, applicable metric means, regression examples, review counts, and limitations. The JSON export preserves the full versioned contract and all paired example payloads.

Review assignments present two outputs as `left` and `right` with an independent hidden candidate mapping. Submit `{ "label": "left" | "right" | "tie" | "both_bad", "score": 0..5, "notes": "..." }`. An authorized adjudicator resolves disagreement separately.

## SDK and CLI

The Python package provides a small client for the versioned JSON endpoints. The CLI commands are `evalboard seed`, `evalboard worker-once`, `evalboard report <experiment-id>`, and `evalboard gate <experiment-id>`. The gate command exits `0` for pass, `1` for fail, and `2` for incomplete or an operational error. Configuration IDs, dataset hashes, and output records allow a decision to be reproduced without rerunning inference.

## Boundaries

Target credentials are environment references and never response fields. A recorded-run target uses imported outputs. An HTTP target is restricted to configured HTTPS origins; live-model calls require provider credentials. A connected failure is returned as a failed outcome, never as synthetic success.
