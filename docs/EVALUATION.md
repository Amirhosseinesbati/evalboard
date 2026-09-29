# Evaluation protocol and current evidence

EvalBoard compares candidate A and B on the **same immutable dataset version**, selected split, case keys, and repetition numbers. A synthetic bundled-target run validates workflow and scoring mechanics; it is not a live-model benchmark. This document records both the evaluation contract and what has actually been verified. Any result without a recorded numerator, denominator, split, configuration, and source remains **pending**.

## Reproducible unit of analysis

An experiment identifies its dataset version, A and B configurations, selected split, the explicit selected case IDs, repetition count, budget, and optional release gate. The unique inference unit is `(experiment, case, candidate, repetition)`. The paired unit is `(experiment, case, repetition)` with both candidate outcomes present. Target output must be committed before scoring so that re-scoring cannot cause a new model call. Retry attempts and worker recovery must not create extra scored units.

For `N` selected cases and `R` repetitions, the planned paired denominator is `N × R`; the planned target-call denominator is `2 × N × R`. The comparison derives its denominator from the stored selection, exposes missing pairs, and cannot become complete merely because an absent pair was never inserted. A terminal timeout, provider error, invalid output, or budget exhaustion is recorded explicitly and is never silently dropped. Cancellation and unstarted budget-limited work are reported as incomplete work rather than successes. Completion counts, terminal-failure counts, per-metric eligible counts, and paired counts must be shown separately. Inference latency excludes queue wait; both are recorded separately. A missing price or usage record is **unknown cost**, not USD 0.

## Metric contract

Evaluator plugins declare a stable key, unit, direction, applicable tasks, and treatment of a failed target call. A metric is aggregated only over its declared applicable rows. The comparison reports a primary metric **by task**, with no universal mean across unlike tasks. The current deterministic plugins are:

| Metric key | Eligible cases | Unit and direction | Implemented computation |
| --- | --- | --- | --- |
| `exact_match` | QA, adversarial, tool use, extraction | Fraction; higher | Python answer-value equality against `expected.answer`. |
| `structured_task_correct` | Extraction | Fraction; higher | Both exact extracted answer and the expected abstention decision must be correct; this is the extraction primary metric. |
| `normalized_match` | QA, adversarial | Fraction; higher | Casefold the answer, replace runs of non-word characters with spaces, and compare with the expected answer after the same transform. |
| `structured_valid` | Extraction | Fraction; higher | Validate the answer using the case's Draft 2020-12 JSON Schema and format checker. This tests structure, not factual correctness. |
| `action_correct` | Tool use | Fraction; higher | Exact equality for expected action name and argument object. |
| `retrieval_recall` | QA, adversarial | Fraction; higher | `|expected evidence IDs ∩ output.retrieved_ids| / |expected evidence IDs|`. Only recorded IDs are observable; retrieval text quality is outside this metric. |
| `citation_support` | QA, adversarial | Fraction; higher | A cited ID must be nonempty and within supplied document IDs, and the answer must pass normalized reference match. This is a **deterministic proxy**, not semantic entailment verification. |
| `abstention_correct` | Abstention, extraction | Fraction; higher | Boolean equality between output `abstained` and the case label, including receipts with a missing required field. |
| `latency_ms` | All tasks with measured inference time | Milliseconds; lower | Recorded target-call time, separate from `queue_wait_ms`. Missing measurements stay missing. |
| `token_cost_usd` | All tasks with known cost | USD; lower | Recorded per-call cost from known usage and configured prices. Missing usage or price stays unknown. |

All deterministic correctness plugins assign `0` to an applicable failed or timed-out call; `latency_ms` and `token_cost_usd` use missing values instead. Scores are not assigned to inapplicable task types. The task primary metrics are `normalized_match` for QA and adversarial, `action_correct` for tool use, `structured_task_correct` for extraction, and `abstention_correct` for abstention. A schema-valid answer can still be factually wrong; action correctness, evidence ID recall, citation proxy, and answer correctness remain separate. The optional model-judge rubric from the brief is **not yet verified as an implemented evaluator**; no judge result is included in the fixture evidence below.

## Comparison and uncertainty

For each metric and task type, report A and B numerators and eligible denominators, the paired-case count, and `B − A` in that metric's unit. The implemented report records metric means and observation counts, primary deltas by task, regression and improvement examples, run-status counts, missing pairs, and configuration differences. A regression uses the case's task-specific primary metric. The report currently records means rather than medians or full latency/cost distributions; this limits interpretation of tail behavior. Do not interpret a cheaper candidate as better when quality or unknown-cost coverage changes materially.

The current comparison computes a paired bootstrap interval for numeric B-minus-A differences when at least 30 comparable pairs exist: 2,000 samples with replacement, random seed `1024`, and the 2.5th/97.5th percentile positions. Repetitions of the same case and templated variants are correlated; this implementation resamples pair rows and therefore can understate uncertainty on such data. It is a descriptive fixture interval, not a customer-population confidence claim. For fewer than 30 pairs, the interval is absent. A fixed-seed bootstrap fixture is included in the passing backend suite.

## Human and model review

Blinded review displays the two recorded outputs and shared evidence without a visible candidate identity, model name, prompt, cost, or layout cue. The side mapping is stored with each assignment; swapping A/B labels must not change the underlying evidence. Use the restricted **reviewer** role for independently blinded scoring: it cannot access unblinded experiment routes. Admin/operator review is masked in the review interface but those users can inspect unblinded results elsewhere, so it is not independently blinded. A reviewer may select left, right, tie, or both bad, add a 0–5 score and notes; disagreements require an adjudicated decision before they are treated as resolved. Review sample size, selection rule, reviewer count, disagreements, and adjudications belong in the exported report. An optional model judge is not implemented in this evidence; a future judge must treat candidate output as quoted data and avoid executing instructions inside it. Target calls receive `input` and `context`, never `expected`.

## Release gate and CI

A release gate has explicit thresholds and is applied to the recorded results of a named experiment. The default thresholds are `min_task_delta: 0.0` and `max_regressions: 0`; `min_<task_type>_delta` can override the minimum for a task. Each task's primary B-minus-A delta must meet its threshold, and the regression count cannot exceed its cap. A missing or nonterminal pair, insufficient task coverage, cancelled run, or ambiguous provider/budget outcome makes the decision `incomplete`, even when a numerical gate condition also fails. Gate failures remain visible separately. An unresolved review changes an otherwise passing decision to `incomplete`; a confirmed metric failure remains `fail`. The versioned report stores thresholds, observed task deltas, coverage, failures, and source. `evalboard gate <experiment-id>` exits `0` for pass, `1` for fail, and `2` for incomplete. Backend integration tests verified that a seeded 40-pair return-policy regression fails and a seeded 40-pair repaired candidate passes. Exported decisions must be reproducible from stored outputs without rerunning inference.

## Data separation and leakage prevention

The generated 240 rows contain 80 development and 160 held-out cases, 16 and 32 per task type. The 30 checked references are all in development. The target boundary receives case input and context but not `expected`; hidden labels belong outside its prompts, tools, and retrieval index. Version hashes, case keys, configurations, model IDs, prompts, retrieval options, price schedule, and judge version must be recorded with a result. Evaluation work should use development for tuning and reserve held-out for a later locked comparison. The current generator separates wording/layout template pools but repeats underlying policy facts and status families across splits, so held-out fixture performance is not an unbiased generalization estimate; see `DATA_CARD.md`.

## Executed synthetic comparison

On 2026-09-28, a fresh SQLite demo ran experiment `62283a81405e497d968e4f7a0407adad` through one worker at concurrency 1. Both bundled configurations received all 240 selected cases once: **480/480 case runs completed, 240/240 planned pairs, 0 failed runs, 0 regressions, and 16 improvements**. Six independently blinded assignments were reviewed; the default no-regression gate then returned `pass`. The saved [JSON report](../evals/results/full_bundled_run_2026-09-28.json) labels its source `bundled_fixture` and records the dataset hash, selected IDs, versioned metrics, and review summary. This is a deterministic support fixture check, not a live-model quality claim.

| Task | A successes | B successes | Comparable / planned pairs | Primary B−A delta | Paired bootstrap interval |
| --- | ---: | ---: | ---: | ---: | ---: |
| Grounded QA | 40/48 | 48/48 | 48 / 48 | +0.166667 | [0.062500, 0.270833] |
| Tool use | 48/48 | 48/48 | 48 / 48 | 0 | [0, 0] |
| Structured extraction | 48/48 | 48/48 | 48 / 48 | 0 | [0, 0] |
| Abstention | 48/48 | 48/48 | 48 / 48 | 0 | [0, 0] |
| Adversarial | 40/48 | 48/48 | 48 / 48 | +0.166667 | [0.062500, 0.270833] |

The intervals reflect resampling of correlated synthetic pair rows and should not be read as customer-population uncertainty. The six seeded historical experiments each contain 40 planned pairs and are explicitly marked `simulated_history`:

| Historical scenario | Completed / failed case runs | Regressions / improvements | Gate |
| --- | ---: | ---: | --- |
| Baseline support | 80 / 0 | 0 / 0 | pass |
| Cheaper faster, return regression | 80 / 0 | 2 / 0 | fail |
| Return policy repaired | 80 / 0 | 0 / 2 | pass |
| Timeout spike | 75 / 5 | 5 / 0 | fail |
| Schema break | 80 / 0 | 8 / 0 | fail |
| Abstention calibration | 80 / 0 | 0 / 8 | pass |

## Verification record

| Check | Actual evidence as of 2026-09-28 | Status |
| --- | --- | --- |
| Generator count and case-key uniqueness | On Windows with Python 3.12.13, `python evals/run_fixtures.py` exited 0 on the final generator. All 7 assertions passed: 240 rows and unique keys, 48 per task, 80 development/160 held-out, 30 `reference_checked` rows. Dataset hash: `1c385bb4d14916d03b58e7aee1b926ff80845740961580745e6edae4646e3daa`. | Verified fixture structure |
| JSONL parser fixtures | The same run accepted 5/5 rows with 0 errors from [known_answer.jsonl](../evals/datasets/known_answer.jsonl). It accepted 1 row and reported malformed JSON at row 2 and a duplicate key at row 3 in [invalid_import.jsonl](../evals/datasets/invalid_import.jsonl). See [dataset contract result](../evals/results/dataset_contract_2026-09-28.json) and [import result](../evals/results/fixture_import_2026-09-28.json). | Verified parser contract only |
| Reference-label consistency | Manually compared all 30 tagged cases with their supplied KB text, order record, receipt, or lack of evidence: 30/30 consistent, 0 discrepancies. Repeated abstention wording noted in `DATA_CARD.md`. | Verified synthetic references |
| Backend automated checks | The Windows/Python 3.12.13 experiment-graph run passed 15/15 tests. Four later focused adapter-validation tests passed. After the retention and Markdown additions, whole-package Ruff passed and mypy reported no issues in 17 source files. Direct isolated assertions passed for retention core and Markdown rendering; a fresh full pytest run after those additions did not complete on this host. Tests include static Alembic upgrade/downgrade, source provenance, blind A/B swap, review lifecycle, and security validation. | Verified main suite and focused checks; final full rerun pending |
| Deterministic evaluator known-answer fixtures | The backend suite includes a missing-field extraction metric case; the dataset fixture runner passed 7/7 structure checks. A full metric-by-metric known-answer matrix is not recorded. | Partial |
| Failure denominators, cost arithmetic, intervals, budget enforcement | The backend suite includes known-answer cost arithmetic and fixed-seed bootstrap tests, per-candidate budget caps, negative-cost rejection, and worker budget reservation. The completed synthetic full run recorded 480/480 case outcomes and 240/240 planned pairs; it had 0 failed runs, 0 regressions, and 16 improvements. | Verified synthetic workflow; broader matrix pending |
| Worker kill/restart and duplicate protection | A separate slow bundled experiment `275108552f624b9b9a7cc4f33f8abe94` ran with one worker and a 5 s lease. At process kill, 50/80 case runs were completed and one was running. After a single worker restart, 79/80 were completed and one in-flight case was marked `uncertain`; zero remained running, one `job_recovered` event was recorded, and there were zero duplicate score keys. Its report decision was `incomplete`. | Verified process recovery |
| Experiment-graph interrupt and recovery | A second isolated slow bundled run `7de3d39991d64b67a81103fdd95a4752` was killed at 37 completed/1 running; after restart it reached 79 completed/1 uncertain with one recovery event and zero duplicate score keys. The graph reached a persisted human-review interrupt, resumed after decisions, and finalized. Its release report kept the numerical gate failure visible but returned `incomplete`; CLI exit was 2. | Verified isolated process recovery and review resume |
| Historical simulated experiment counts and gate outcomes | The six-scenario table above was read from the fresh seeded database; the backend integration suite separately asserted a 40-pair regression `fail` and a 40-pair repaired candidate `pass`. | Verified synthetic fixtures |
| Browser journeys and API contract | On 2026-09-28, one-worker Playwright ran 4/4 primary paths in 22.0 s against the fresh seeded local demo: persisted cancellation, failed-case filter and reason, blinded reviewer keyboard decision, and report JSON download/source. A later focused gate-dialog keyboard journey passed 1/1. The OpenAPI check validated 29 client operations and 7 request schemas against `http://127.0.0.1:8010/openapi.json`. The backend suite includes a blind A/B swap invariant test; a broader cross-workspace access matrix remains pending. | Verified critical paths; broader access matrix pending |
| Markdown export and retention | A live Markdown export of the full synthetic report returned HTTP 200 with task-primary and dataset-hash sections. Workspace-scoped content redaction core assertions passed by direct invocation on an isolated temporary SQLite database. The live demo-database CLI dry run selected zero pre-2020 experiments; apply without matching confirmation returned exit 2 without changes. Pytest collection for the added retention file did not complete under host load, so its CLI fixture test remains unverified. | Partial final verification |
| Small paired run against a real model | No credentials or bounded-cost run result recorded here. | Pending live verification |

Direct CLI gate checks from `apps/api` used `python -m evalboard.cli gate <experiment_id>`: the seeded return regression returned exit **1** (`fail`), the repaired candidate exit **0** (`pass`), and the full bundled run exit **0** (`pass`). Exact IDs and commands are in [the recorded results](../evals/results/REPORT.md). The backend automated suite, full paired synthetic run, worker process restart, and four browser journeys have passed. Never present deterministic fixture scores as observed live-model quality.
