"""Paired comparisons, reproducible intervals, and explicit release decisions."""

import random
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from evalboard.evaluators import METRIC_BY_KEY, primary_metric
from evalboard.models import (
    Artifact,
    CandidateConfig,
    Case,
    CaseRun,
    DatasetVersion,
    Experiment,
    ReleaseGate,
    ReviewAssignment,
    ReviewDecision,
    Score,
    TargetAdapterRecord,
)
from evalboard.retention import REDACTION_KIND


def _mean(values: list[float]) -> float | None:
    return statistics.mean(values) if values else None


def _paired_interval(differences: list[float], seed: int = 1024) -> list[float] | None:
    if len(differences) < 30:
        return None
    rng = random.Random(seed)
    samples = [statistics.mean(rng.choices(differences, k=len(differences))) for _ in range(2000)]
    samples.sort()
    return [round(samples[49], 6), round(samples[1949], 6)]


def compare(db: Session, experiment: Experiment) -> dict[str, Any]:
    runs = db.scalars(select(CaseRun).where(CaseRun.experiment_id == experiment.id)).all()
    cases = {case.id: case for case in db.scalars(select(Case).where(Case.dataset_version_id == experiment.dataset_version_id))}
    scores = db.scalars(select(Score).where(Score.case_run_id.in_([r.id for r in runs]))).all() if runs else []
    score_map = {(s.case_run_id, s.metric_key): s for s in scores}
    grouped: dict[tuple[str, int], dict[str, CaseRun]] = defaultdict(dict)
    for run in runs:
        grouped[(run.case_id, run.repetition)][run.candidate_label] = run
    paired = [(key, pair["A"], pair["B"]) for key, pair in grouped.items() if "A" in pair and "B" in pair]
    complete_pairs = [(key, a, b) for key, a, b in paired if a.status not in ("pending", "running") and b.status not in ("pending", "running")]
    if experiment.selection_json:
        selected_case_ids = list(experiment.selection_json)
    else:
        # Compatibility for older experiments created before explicit selection storage.
        selected = [c for c in cases.values() if experiment.split == "all" or c.split == experiment.split]
        selected_case_ids = [c.id for c in sorted(selected, key=lambda c: c.case_key)[:experiment.max_cases]]
    planned_pair_count = len(selected_case_ids) * experiment.repetitions
    planned_by_task: dict[str, int] = defaultdict(int)
    for case_id in selected_case_ids:
        if case_id in cases:
            planned_by_task[cases[case_id].task_type] += experiment.repetitions

    metric_rows: list[dict[str, Any]] = []
    for metric_key, metric in METRIC_BY_KEY.items():
        a_values: list[float] = []
        b_values: list[float] = []
        differences: list[float] = []
        for (case_id, _), a, b in complete_pairs:
            if cases[case_id].task_type not in metric.tasks:
                continue
            a_score = score_map.get((a.id, metric_key))
            b_score = score_map.get((b.id, metric_key))
            if a_score and a_score.applicable and a_score.value is not None:
                a_values.append(a_score.value)
            if b_score and b_score.applicable and b_score.value is not None:
                b_values.append(b_score.value)
            if a_score and b_score and a_score.applicable and b_score.applicable and a_score.value is not None and b_score.value is not None:
                differences.append(b_score.value - a_score.value)
        if not a_values and not b_values:
            continue
        metric_rows.append({
            "metric_key": metric_key,
            "label": metric.label,
            "unit": metric.unit,
            "direction": metric.direction,
            "a": {"mean": _mean(a_values), "count": len(a_values)},
            "b": {"mean": _mean(b_values), "count": len(b_values)},
            "delta": _mean(differences),
            "paired_count": len(differences),
            "confidence_interval": _paired_interval(differences),
        })

    regression_rows: list[dict[str, Any]] = []
    improvement_rows: list[dict[str, Any]] = []
    task_deltas: dict[str, list[float]] = defaultdict(list)
    task_a_values: dict[str, list[float]] = defaultdict(list)
    task_b_values: dict[str, list[float]] = defaultdict(list)
    for (case_id, repetition), a, b in complete_pairs:
        case = cases[case_id]
        key = primary_metric(case.task_type)
        a_score = score_map.get((a.id, key))
        b_score = score_map.get((b.id, key))
        if not (a_score and b_score and a_score.value is not None and b_score.value is not None):
            continue
        delta = b_score.value - a_score.value
        task_deltas[case.task_type].append(delta)
        task_a_values[case.task_type].append(a_score.value)
        task_b_values[case.task_type].append(b_score.value)
        row = {
            "case_id": case.id,
            "case_key": case.case_key,
            "task_type": case.task_type,
            "input": case.input_json,
            "expected": case.expected_json,
            "evidence": case.context_json,
            "repetition": repetition,
            "metric_key": key,
            "a": {"run_id": a.id, "answer": (a.output_json or {}).get("answer"), "output": a.output_json, "score": a_score.value, "status": a.status, "error_category": a.error_category, "error_message": a.error_message, "latency_ms": a.latency_ms, "cost_usd": a.cost_usd},
            "b": {"run_id": b.id, "answer": (b.output_json or {}).get("answer"), "output": b.output_json, "score": b_score.value, "status": b.status, "error_category": b.error_category, "error_message": b.error_message, "latency_ms": b.latency_ms, "cost_usd": b.cost_usd},
            "delta": delta,
        }
        if delta < 0:
            regression_rows.append(row)
        elif delta > 0:
            improvement_rows.append(row)

    config_a = db.get(CandidateConfig, experiment.candidate_a_id)
    config_b = db.get(CandidateConfig, experiment.candidate_b_id)
    def public_config(config: CandidateConfig | None) -> dict[str, Any]:
        if not config:
            return {}
        return {
            "name": config.name,
            "model_id": config.model_id,
            "prompt": config.prompt,
            "options": config.options_json,
            "budget_usd": config.budget_usd,
            "concurrency": config.concurrency,
        }

    return {
        "experiment_id": experiment.id,
        "status": experiment.status,
        "paired_count": len(complete_pairs),
        "denominator": planned_pair_count,
        "missing_pairs": max(0, planned_pair_count - len(paired)),
        "metrics": metric_rows,
        "primary": {
            "description": "Task-specific paired correctness; no universal quality score.",
            "by_task": {
                task: {
                    "mean_delta": _mean(task_deltas.get(task, [])),
                    "a_mean": _mean(task_a_values.get(task, [])),
                    "b_mean": _mean(task_b_values.get(task, [])),
                    "a_success_count": sum(value == 1 for value in task_a_values.get(task, [])),
                    "b_success_count": sum(value == 1 for value in task_b_values.get(task, [])),
                    "count": len(task_deltas.get(task, [])),
                    "planned_count": planned_count,
                    "confidence_interval": _paired_interval(task_deltas.get(task, [])),
                }
                for task, planned_count in planned_by_task.items()
            },
        },
        "regressions": regression_rows,
        "improvements": improvement_rows,
        "config_diff": {"a": public_config(config_a), "b": public_config(config_b)},
        "counts": {
            "total_runs": len(runs),
            "completed_runs": sum(r.status == "completed" for r in runs),
            "failed_runs": sum(r.status in ("failed", "uncertain") for r in runs),
            "cancelled_runs": sum(r.status == "cancelled" for r in runs),
            "regressions": len(regression_rows),
            "improvements": len(improvement_rows),
        },
    }


def report(db: Session, experiment: Experiment) -> dict[str, Any]:
    comparison = compare(db, experiment)
    gate = db.get(ReleaseGate, experiment.gate_id) if experiment.gate_id else None
    thresholds = gate.thresholds_json if gate else {"max_regressions": 0, "min_task_delta": 0.0}
    failures: list[str] = []
    if experiment.status not in ("completed", "review_pending"):
        decision = "incomplete"
    else:
        by_task = comparison["primary"]["by_task"]
        coverage_complete = (
            comparison["paired_count"] == comparison["denominator"]
            and comparison["missing_pairs"] == 0
            and all(row["count"] == row["planned_count"] for row in by_task.values())
        )
        if not coverage_complete:
            decision = "incomplete"
        else:
            if len(comparison["regressions"]) > thresholds.get("max_regressions", 0):
                failures.append("regression count above threshold")
            for task, task_row in by_task.items():
                required = thresholds.get(f"min_{task}_delta", thresholds.get("min_task_delta", 0.0))
                if task_row["mean_delta"] is None or task_row["mean_delta"] < required:
                    failures.append(f"{task} delta below threshold")
            decision = "fail" if failures else "pass"
    pending_reviews = db.scalars(
        select(ReviewAssignment).where(
            ReviewAssignment.experiment_id == experiment.id,
            ReviewAssignment.status.in_(["pending", "disagreement"]),
        )
    ).all()
    error_runs = db.scalars(
        select(CaseRun).where(
            CaseRun.experiment_id == experiment.id,
            CaseRun.error_category.in_(["budget_exhausted", "budget_unknown", "uncertain_inference", "timeout_uncertain"]),
        )
    ).all()
    if error_runs:
        decision = "incomplete"
    if pending_reviews and decision == "pass":
        decision = "incomplete"
    version = db.get(DatasetVersion, experiment.dataset_version_id)
    all_reviews = db.scalars(select(ReviewAssignment).where(ReviewAssignment.experiment_id == experiment.id)).all()
    all_decisions = db.scalars(select(ReviewDecision).where(
        ReviewDecision.assignment_id.in_([review.id for review in all_reviews])
    )).all() if all_reviews else []
    review_status_counts = Counter(review.status for review in all_reviews)
    configs = [db.get(CandidateConfig, identifier) for identifier in (experiment.candidate_a_id, experiment.candidate_b_id)]
    has_bundled = any(
        target is not None and target.kind == "bundled"
        for config in configs if config is not None
        for target in [db.get(TargetAdapterRecord, config.target_id)]
    )
    content_redacted = db.scalar(select(Artifact.id).where(
        Artifact.workspace_id == experiment.workspace_id,
        Artifact.experiment_id == experiment.id,
        Artifact.kind == REDACTION_KIND,
    ).limit(1)) is not None
    return {
        "version": "1.0",
        "experiment_id": experiment.id,
        "name": experiment.name,
        "source": experiment.source,
        "decision": decision,
        "gate": {"id": gate.id if gate else None, "name": gate.name if gate else "Default no-regression gate", "thresholds": thresholds, "failures": failures},
        "comparison": comparison,
        "provenance": {
            "dataset_version_id": experiment.dataset_version_id,
            "dataset_content_hash": version.content_hash if version else None,
            "selected_case_ids": list(experiment.selection_json or []),
            "split": experiment.split,
            "repetitions": experiment.repetitions,
            "evaluator_version": "1.0.0",
            "metric_keys": sorted(METRIC_BY_KEY),
        },
        "review_summary": {
            "assignments": len(all_reviews),
            "decisions": len(all_decisions),
            "by_status": dict(review_status_counts),
            "by_label": dict(Counter(item.label for item in all_decisions)),
        },
        "pending_reviews": len(pending_reviews),
        "uncertain_or_budget_runs": len(error_runs),
        "content_redacted": bool(content_redacted),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "limitations": [
            "Synthetic demo results do not establish real-customer model quality."
            if experiment.source == "simulated_history" or has_bundled
            else "Check target kind and data split before interpreting quality.",
            "Confidence intervals are paired bootstrap intervals only when at least 30 comparable pairs exist.",
            "Unknown provider prices remain unknown and are excluded from cost means.",
            *(["Candidate outputs, error text, trace payloads, review notes, and score details were redacted; numeric scores and counts remain. Immutable case input, expected answers, and context are still stored."] if content_redacted else []),
        ],
    }
