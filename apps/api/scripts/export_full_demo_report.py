"""Reconcile and export the known complete synthetic acceptance experiment."""

import json
from pathlib import Path

from sqlalchemy import select

from evalboard.analysis import report
from evalboard.db import SessionLocal
from evalboard.models import CandidateConfig, Experiment, ReviewAssignment, TargetAdapterRecord

NAME = "Full 240-pair policy repair · synthetic"
OUTPUT = Path(__file__).resolve().parents[3] / "evals" / "results" / "full_bundled_run_2026-09-28.json"


def main() -> None:
    with SessionLocal() as db:
        experiment = db.scalar(select(Experiment).where(Experiment.name == NAME))
        if experiment is None:
            raise SystemExit("Full synthetic experiment is missing")
        for config_id in (experiment.candidate_a_id, experiment.candidate_b_id):
            config = db.get(CandidateConfig, config_id)
            target = db.get(TargetAdapterRecord, config.target_id) if config else None
            if target is None or target.kind != "bundled":
                raise SystemExit("Refusing to relabel a non-bundled experiment")
        unresolved = db.scalar(select(ReviewAssignment.id).where(
            ReviewAssignment.experiment_id == experiment.id,
            ReviewAssignment.status.in_(["pending", "disagreement"]),
        ))
        experiment.source = "bundled_fixture"
        if unresolved is None and experiment.status == "review_pending":
            experiment.status = "completed"
        db.commit()
        full = report(db, experiment)
        comparison = full["comparison"]
        artifact = {
            "version": full["version"],
            "generated_at": full["generated_at"],
            "experiment_id": experiment.id,
            "experiment_name": experiment.name,
            "experiment_status": experiment.status,
            "source": experiment.source,
            "decision": full["decision"],
            "gate": full["gate"],
            "provenance": full["provenance"],
            "review_summary": full["review_summary"],
            "counts": {
                **comparison["counts"],
                "planned_pairs": comparison["denominator"],
                "paired_count": comparison["paired_count"],
                "missing_pairs": comparison["missing_pairs"],
                "pending_reviews": full["pending_reviews"],
            },
            "primary": comparison["primary"],
            "metrics": comparison["metrics"],
            "limitations": full["limitations"],
        }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "path": str(OUTPUT),
        "experiment_id": artifact["experiment_id"],
        "status": artifact["experiment_status"],
        "source": artifact["source"],
        "decision": artifact["decision"],
        "counts": artifact["counts"],
        "primary": artifact["primary"],
        "review_summary": artifact["review_summary"],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
