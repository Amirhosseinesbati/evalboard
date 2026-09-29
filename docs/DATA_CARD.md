# Synthetic demo dataset: Aster Supply

**Status:** generated fixture dataset, not customer data. **Generator:** `apps/api/src/evalboard/dataset.py`. **Default seed:** `2406`. **Default reference date:** `2026-09-01`; the generator accepts a different seed and reference date. Dataset versions are identified by a hash of their canonical case payloads. The generated cases and historical runs, where seeded, must be displayed as **Synthetic demo dataset** and **Simulated experiment**.

## Intended use and provenance

Aster Supply is a fictional support organization. Its five short knowledge-base articles cover standard and clearance returns, shipping, warranty, and refunds. A scoped order simulator supplies fictional order IDs and statuses. Cases are generated in code; no customer information or paid model generation is involved. The data is intended to exercise EvalBoard's import, paired-run, review, regression, and release-report workflow. It does not measure real-customer accuracy or model superiority.

| Task type | Development | Held out | Total | Reference cases reviewed |
| --- | ---: | ---: | ---: | ---: |
| Grounded question answering | 16 | 32 | 48 | 6 |
| Tool use | 16 | 32 | 48 | 6 |
| Structured extraction | 16 | 32 | 48 | 6 |
| Abstention | 16 | 32 | 48 | 6 |
| Adversarial input | 16 | 32 | 48 | 6 |
| **Total** | **80** | **160** | **240** | **30** |

The first 16 cases of each task type are assigned to `development`; the remaining 32 are assigned to `held_out`. All 30 tagged `reference_checked` cases are in development. A case has a stable `case_key`, task type, split, input, expected values, context, and tags. The import schema accepts these fields in JSONL and reports validation errors with source row numbers. A dataset edit must create a new immutable version; experiments bind to one version.

A final generator invocation on 2026-09-28 returned 240 rows with 240 distinct keys, the counts above, 30 `reference_checked` tags, and dataset hash `1c385bb4d14916d03b58e7aee1b926ff80845740961580745e6edae4646e3daa`. Within grounded QA, each of the six policy facts occurs eight times. Tool statuses are balanced at eight cases each for `processing`, `dispatched`, `delivered`, `return_requested`, `delivery_exception`, and `cancelled`. The 48 extraction dates span 2026-07-15 to 2026-08-31 for the default reference date. These are fixture distributions, not estimated customer frequencies.

## Scenarios and planted conditions

- Grounded answers use the six documented policy facts. The expected answer and evidence ID are derived from the relevant article. Five held-out cases include an unrelated distractor document.
- Order cases ask for the status of a fictional order. Expected `lookup_order` arguments use the same order ID as the request and simulator record.
- Extraction cases use eight ordinary receipt layouts with order ID, amount in USD, and purchase date derived from the configurable reference date, plus a variant without an amount. Three held-out receipts omit the amount and require abstention with an empty answer object.
- Abstention cases ask for unavailable or private facts with empty document context.
- Adversarial cases place an instruction attempt in `untrusted_customer_text` while the expected answer remains tied to the policy article.
- The seed routine defines six historical simulated experiments: Baseline support; Cheaper faster, return regression; Return policy repaired; Timeout spike; Schema break; and Abstention calibration. It selects eight held-out cases per task, or 40 pairs per experiment, for 480 case-run rows across all six. Planted conditions include a wrong return window, timeout outcomes, invalid extraction schema, weak abstention, unknown cost, and a reviewer disagreement. The fresh seeded database's actual counts and gate outcomes are recorded in [EVALUATION.md](EVALUATION.md). They must never be presented as live-model benchmark results.

## Reference audit

On 2026-09-28, the generated payloads of all 30 `reference_checked` cases (`AST-01-001`–`006` through `AST-05-001`–`006`) were inspected against the corresponding knowledge-base text, order record, receipt text, or absence of supporting evidence. **30/30 expected values, actions, arguments, evidence IDs, and abstention labels were consistent with those supplied scenarios; no discrepancy was found.** This checks fixture consistency, not the correctness of a model's answers. In the abstention group, cases 5 and 6 repeat the question wording of cases 1 and 2; adversarial cases reuse the six QA facts with added untrusted text. Thus 30 checked rows are not 30 distinct underlying facts or templates.

## Leakage controls and split limits

`expected` is stored separately from `input` and `context`. The bundled target receives the latter two and never receives `expected`; the support knowledge base contains policy facts, not hidden expected labels. Evaluation and judge code must keep labels out of target prompts and retrieval indexes. Reviews and exports may expose expected values only to authorized users after inference is recorded. Candidate output and imported text are untrusted data, including text that resembles instructions.

The current generator uses disjoint development and held-out wording/layout template pools for each task. Order and receipt identifiers are distinct across splits, but the same small set of policy facts and status types recurs. The split is deterministic by row position within each task, **not** a strict separation by underlying policy fact or time. Treat held-out results as a workflow check and limited regression signal, not an unbiased estimate of generalization. A customer evaluation should use independently sourced, access-controlled held-out cases and audit overlap before making a release claim.

## Known limitations

The support corpus is small, English-only, and deliberately simpler than a real support operation. Shared policy facts and repeated unsupported-question families reduce effective sample diversity despite the expanded templates. Four rows are tagged semantic duplicates and three extraction rows have a missing amount; duplicate **case keys** remain an import-validation fixture, not part of the 240 valid rows. The reference audit is based on fictional source records, not external truth. No real provider latency, token cost, reliability, or quality is established by this dataset. The historical fixture totals and full synthetic run are recorded in [EVALUATION.md](EVALUATION.md); live-model sample statistics remain pending.
