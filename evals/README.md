# Evaluation assets

`datasets/known_answer.jsonl` contains five hand-checked task fixtures for deterministic evaluator and import smoke checks. `datasets/invalid_import.jsonl` intentionally contains malformed JSON on row 2 and a duplicate case key on row 3; these are validation fixtures, not benchmark data.

The full synthetic 240-case corpus is generated reproducibly from `apps/api/src/evalboard/dataset.py` with seed 2406 and reference date 2026-09-01. Run output, measured counts, and any live-model experiment belong in `results/` with the dataset hash, configuration IDs, code version, date, and environment. Do not treat the five fixtures or historical simulated runs as evidence of live-model superiority.

From the project root, after installing API dependencies, run:

```sh
python evals/run_fixtures.py --output evals/results/dataset_contract.json
```

The runner exits nonzero if import behavior, case counts, splits, keys, or reference-tag counts diverge from the fixture contract. Its stored result from 2026-09-28 is `results/dataset_contract_2026-09-28.json`.
