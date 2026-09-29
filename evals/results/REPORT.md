# Recorded evaluation results

## 2026-09-28 — JSONL parser fixture

Using bundled Python 3.12.13 with `apps/api/src` on `PYTHONPATH`, `parse_jsonl` accepted all 5 cases in `known_answer.jsonl` with no errors. For `invalid_import.jsonl`, it accepted 1 case and identified row 2 as malformed JSON and row 3 as a duplicate `case_key`. The machine-readable record is `fixture_import_2026-09-28.json`.

This is deterministic parser validation. It does not verify the HTTP endpoint, durable worker, model quality, latency, or release gate. Those checks need separate recorded runs with numerator, denominator, configuration, and environment.

## 2026-09-28 — final synthetic generator contract

After the generator's schema and diversity changes, `python evals/run_fixtures.py` exited 0 again with 7/7 assertions. It produced 240 unique cases, 48 per task, 80 development and 160 held-out, and 30 `reference_checked` tags. The final dataset hash is `1c385bb4d14916d03b58e7aee1b926ff80845740961580745e6edae4646e3daa`. The machine-readable contract record is `dataset_contract_2026-09-28.json`.

## 2026-09-28 — complete bundled paired run

The fresh local SQLite demo ran `Full 240-pair policy repair · synthetic` (`62283a81405e497d968e4f7a0407adad`) through FastAPI on port 8010 and one durable worker with candidate concurrency 1. The source is `bundled_fixture`, with the final generator hash above. All 480 planned case-runs completed; 240/240 planned pairs were scored; failures, uncertain outcomes, missing pairs, and regressions were 0. Candidate B improved 16 pairs. Six blinded review assignments received six decisions (one right, five ties); no reviews remained pending. The task-specific no-regression gate (`min_task_delta=0`, `max_regressions=0`) returned **pass**. The machine-readable summary, including configuration provenance, task metrics, intervals, and review counts, is [full_bundled_run_2026-09-28.json](full_bundled_run_2026-09-28.json).

| Primary task correctness | A successes | B successes | Paired/planned | B − A | 95% paired bootstrap interval |
|---|---:|---:|---:|---:|---:|
| Grounded QA | 40/48 | 48/48 | 48/48 | +0.166667 | [0.0625, 0.270833] |
| Tool use | 48/48 | 48/48 | 48/48 | 0 | [0, 0] |
| Structured extraction | 48/48 | 48/48 | 48/48 | 0 | [0, 0] |
| Abstention | 48/48 | 48/48 | 48/48 | 0 | [0, 0] |
| Adversarial | 40/48 | 48/48 | 48/48 | +0.166667 | [0.0625, 0.270833] |

The six seeded `simulated_history` fixtures each use 40 planned held-out pairs (8 per task):

| Scenario | Completed / failed / uncertain runs | Regressions / improvements | Gate |
|---|---:|---:|---|
| Baseline support | 80 / 0 / 0 | 0 / 0 | pass |
| Cheaper faster, return regression | 80 / 0 / 0 | 2 / 0 | fail |
| Return policy repaired | 80 / 0 / 0 | 0 / 2 | pass |
| Timeout spike | 75 / 5 / 0 | 5 / 0 | fail |
| Schema break | 80 / 0 / 0 | 8 / 0 | fail |
| Abstention calibration | 80 / 0 / 0 | 0 / 8 | pass |

Direct CLI gate checks from `apps/api` used `python -m evalboard.cli gate <experiment_id>`:

| Experiment ID | Decision | Exit code |
|---|---|---:|
| `b11baf937ad940bcaf3a3020b7d68668` (return regression) | fail | 1 |
| `f28a5a9e3e84498b9e5e21dddb774111` (return repaired) | pass | 0 |
| `62283a81405e497d968e4f7a0407adad` (full paired run) | pass | 0 |

A separate process-level recovery check interrupted the sole worker while a slow 80-case-run experiment was active. At interruption, 50 runs were completed and one was running. After a worker restart with a 5-second lease, the job finished with 79 completed and the in-flight run marked `uncertain`; it recorded one `job_recovered` event and zero duplicate score keys. Its report stayed `incomplete`, as required for an unknown external outcome. This was a bundled synthetic target; no live OpenAI key was available, so connected-model quality and billing remain unverified.
