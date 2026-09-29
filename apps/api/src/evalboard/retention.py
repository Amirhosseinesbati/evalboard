"""Workspace-scoped, content-only retention for terminal experiments.

The operation keeps relational rows and numeric evaluation evidence intact. It does
not delete immutable dataset cases or shared target/configuration records.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from evalboard.models import (
    Artifact,
    CaseRun,
    Event,
    Experiment,
    Job,
    ReviewAssignment,
    ReviewDecision,
    Score,
    Workspace,
)

REDACTION_KIND = "retention_redaction"
_REDACTED = {"redacted": True}
_TERMINAL_EXPERIMENTS = {"completed", "cancelled"}
_TERMINAL_RUNS = {"completed", "failed", "uncertain", "cancelled"}
_TERMINAL_JOBS = {"completed", "cancelled", "failed"}


def parse_cutoff(raw: str) -> datetime:
    """Require an explicit ISO-8601 timezone and reject a future retention cutoff."""
    try:
        cutoff = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("--before must be an ISO-8601 datetime with timezone") from exc
    if cutoff.tzinfo is None or cutoff.utcoffset() is None:
        raise ValueError("--before must include a timezone, such as 2026-01-01T00:00:00Z")
    cutoff = cutoff.astimezone(timezone.utc)
    if cutoff > datetime.now(timezone.utc):
        raise ValueError("--before cannot be in the future")
    return cutoff


def _utc(value: datetime) -> datetime:
    # SQLite returns naive DateTime values even when the column is timezone-aware.
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


@dataclass
class _Eligible:
    experiment: Experiment
    runs: Sequence[CaseRun]
    scores: Sequence[Score]
    reviews: Sequence[ReviewAssignment]
    decisions: Sequence[ReviewDecision]
    events: Sequence[Event]
    artifacts: Sequence[Artifact]
    last_activity: datetime


def _eligible(db: Session, workspace_id: str, cutoff: datetime) -> list[_Eligible]:
    if db.get(Workspace, workspace_id) is None:
        raise ValueError("workspace not found")
    query = select(Experiment).where(
        Experiment.workspace_id == workspace_id,
        Experiment.status.in_(_TERMINAL_EXPERIMENTS),
    )
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        query = query.with_for_update()
    eligible: list[_Eligible] = []
    for experiment in db.scalars(query).all():
        runs = db.scalars(select(CaseRun).where(
            CaseRun.workspace_id == workspace_id,
            CaseRun.experiment_id == experiment.id,
        )).all()
        if any(run.status not in _TERMINAL_RUNS for run in runs):
            continue
        job = db.scalar(select(Job).where(
            Job.workspace_id == workspace_id,
            Job.experiment_id == experiment.id,
        ))
        if job is not None and job.status not in _TERMINAL_JOBS:
            continue
        events = db.scalars(select(Event).where(
            Event.workspace_id == workspace_id,
            Event.experiment_id == experiment.id,
        )).all()
        artifacts = db.scalars(select(Artifact).where(
            Artifact.workspace_id == workspace_id,
            Artifact.experiment_id == experiment.id,
        )).all()
        if any(artifact.kind == REDACTION_KIND for artifact in artifacts):
            continue
        reviews = db.scalars(select(ReviewAssignment).where(
            ReviewAssignment.workspace_id == workspace_id,
            ReviewAssignment.experiment_id == experiment.id,
        )).all()
        review_ids = [review.id for review in reviews]
        decisions = db.scalars(select(ReviewDecision).where(
            ReviewDecision.assignment_id.in_(review_ids)
        )).all() if review_ids else []
        run_ids = [run.id for run in runs]
        scores = db.scalars(select(Score).where(
            Score.case_run_id.in_(run_ids)
        )).all() if run_ids else []

        terminal_time = experiment.finished_at
        if terminal_time is None:
            finished_runs = [run.finished_at for run in runs if run.finished_at is not None]
            if finished_runs and len(finished_runs) == len(runs):
                terminal_time = max(finished_runs, key=_utc)
            elif experiment.status == "cancelled":
                cancellations = [event.created_at for event in events if event.kind in {"experiment_cancelled", "job_cancelled"}]
                terminal_time = max(cancellations, key=_utc) if cancellations else None
            elif experiment.source == "simulated_history":
                terminal_time = experiment.created_at
        if terminal_time is None:
            # An old creation time alone cannot prove when an ordinary run ended.
            continue

        activity = [terminal_time, experiment.created_at]
        activity.extend(run.finished_at for run in runs if run.finished_at is not None)
        activity.extend(event.created_at for event in events)
        activity.extend(review.created_at for review in reviews)
        activity.extend(decision.created_at for decision in decisions)
        activity.extend(artifact.created_at for artifact in artifacts)
        last_activity = max((_utc(value) for value in activity))
        if last_activity >= cutoff:
            continue
        eligible.append(_Eligible(experiment, runs, scores, reviews, decisions, events, artifacts, last_activity))
    return eligible


def _counts(items: list[_Eligible]) -> dict[str, int]:
    return {
        "experiments": len(items),
        "case_runs": sum(len(item.runs) for item in items),
        "outputs": sum(run.output_json is not None for item in items for run in item.runs),
        "error_messages": sum(bool(run.error_message) for item in items for run in item.runs),
        "failure_reasons": sum(bool(item.experiment.failure_reason) for item in items),
        "score_details": sum(bool(score.detail_json) for item in items for score in item.scores),
        "review_notes": sum(bool(decision.notes) for item in items for decision in item.decisions),
        "adjudication_notes": sum(bool((review.adjudication_json or {}).get("notes")) for item in items for review in item.reviews),
        "events": sum(len(item.events) for item in items),
        "artifacts": sum(len(item.artifacts) for item in items),
    }


def redact_workspace(
    db: Session,
    workspace_id: str,
    cutoff: datetime,
    *,
    apply: bool = False,
    confirm_workspace_id: str | None = None,
) -> dict[str, Any]:
    """Preview or redact eligible content within the caller's transaction.

    The caller commits only after a successful apply. Dry runs perform no writes.
    """
    if cutoff.tzinfo is None or cutoff.utcoffset() is None:
        raise ValueError("cutoff must include a timezone")
    if _utc(cutoff) > datetime.now(timezone.utc):
        raise ValueError("cutoff cannot be in the future")
    if apply and confirm_workspace_id != workspace_id:
        raise ValueError("--confirm-workspace-id must exactly match --workspace-id")
    items = _eligible(db, workspace_id, _utc(cutoff))
    counts = _counts(items)
    summary: dict[str, Any] = {
        "version": "1.0",
        "mode": "applied" if apply else "dry_run",
        "workspace_id": workspace_id,
        "before_utc": _utc(cutoff).isoformat(),
        "experiment_ids": [item.experiment.id for item in items],
        "counts": counts,
    }
    if not apply:
        return summary

    applied_at = datetime.now(timezone.utc).isoformat()
    for item in items:
        item_counts = _counts([item])
        item.experiment.failure_reason = None
        for run in item.runs:
            run.output_json = None
            run.error_message = None
        for score in item.scores:
            score.detail_json = dict(_REDACTED)
        for decision in item.decisions:
            decision.notes = ""
        for review in item.reviews:
            if review.adjudication_json is not None:
                adjudication = review.adjudication_json
                review.adjudication_json = {
                    key: adjudication[key]
                    for key in ("label", "score", "reviewer_id", "created_at")
                    if key in adjudication
                }
        for event in item.events:
            event.kind = "redacted_event"
            event.payload_json = dict(_REDACTED)
        for artifact in item.artifacts:
            artifact.content_json = dict(_REDACTED)
        db.add(Artifact(
            workspace_id=workspace_id,
            experiment_id=item.experiment.id,
            kind=REDACTION_KIND,
            content_json={
                "version": "1.0",
                "applied_at_utc": applied_at,
                "before_utc": summary["before_utc"],
                "last_activity_utc": item.last_activity.isoformat(),
                "counts": item_counts,
            },
        ))
    db.flush()
    return summary
