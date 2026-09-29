"""Reproducible deterministic data-contract checks; never a live-model benchmark."""

from __future__ import annotations

import argparse
import json
import platform
import sys
from collections import Counter
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api" / "src"))

from evalboard.dataset import generate_cases, parse_jsonl, version_hash  # noqa: E402


def run() -> dict:
    valid, valid_errors = parse_jsonl((ROOT / "evals/datasets/known_answer.jsonl").read_text())
    invalid, invalid_errors = parse_jsonl((ROOT / "evals/datasets/invalid_import.jsonl").read_text())
    generated = generate_cases(seed=2406, reference_date=date(2026, 9, 1))
    by_task = dict(sorted(Counter(case["task_type"] for case in generated).items()))
    by_split = dict(sorted(Counter(case["split"] for case in generated).items()))
    checked = sum("reference_checked" in case["tags"] for case in generated)
    assertions = {
        "valid_fixture_accepted": len(valid) == 5 and not valid_errors,
        "invalid_fixture_rows": len(invalid) == 1 and [e["row"] for e in invalid_errors] == [2, 3],
        "full_dataset_count": len(generated) == 240,
        "task_distribution": len(by_task) == 5 and all(count == 48 for count in by_task.values()),
        "split_distribution": by_split == {"development": 80, "held_out": 160},
        "checked_reference_count": checked == 30,
        "unique_case_keys": len({case["case_key"] for case in generated}) == 240,
    }
    return {
        "version": "1.0",
        "kind": "deterministic_fixture_validation",
        "environment": {"python": platform.python_version(), "platform": platform.platform()},
        "seed": 2406,
        "reference_date": "2026-09-01",
        "dataset_hash": version_hash(generated),
        "generated": {"count": len(generated), "by_task": by_task, "by_split": by_split, "reference_checked": checked},
        "jsonl": {
            "known_answer": {"accepted": len(valid), "errors": valid_errors},
            "invalid_import": {"accepted": len(invalid), "errors": invalid_errors},
        },
        "assertions": assertions,
        "passed": all(assertions.values()),
        "limitations": ["No HTTP, worker, provider, or browser execution is measured by this runner."],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Write machine-readable JSON to this path")
    args = parser.parse_args()
    result = run()
    payload = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    print(payload, end="")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
