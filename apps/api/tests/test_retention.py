"""Focused retention checks on an isolated database, never the seeded demo DB."""

import json
import sys
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from evalboard import cli
from evalboard.db import Base
from evalboard.models import (
    Artifact,
    CandidateConfig,
    Case,
    CaseRun,
    Dataset,
    DatasetVersion,
    Event,
    Experiment,
    Job,
    ReviewAssignment,
    ReviewDecision,
    Score,
    TargetAdapterRecord,
    Workspace,
)
from evalboard.retention import REDACTION_KIND, parse_cutoff, redact_workspace


def _scenario(db, workspace_name: str, *, status: str, timestamp: datetime,
              job_status: str = "completed") -> tuple[Workspace, Experiment, CaseRun, CaseRun, Case]:
    workspace = Workspace(name=workspace_name)
    db.add(workspace)
    db.flush()
    dataset = Dataset(workspace_id=workspace.id, name=f"{workspace_name} dataset")
    db.add(dataset)
    db.flush()
    version = DatasetVersion(
        workspace_id=workspace.id, dataset_id=dataset.id, version_number=1,
        content_hash="a" * 64, case_count=1,
    )
    db.add(version)
    db.flush()
    case = Case(
        workspace_id=workspace.id, dataset_version_id=version.id, case_key="case-1",
        task_type="grounded_qa", split="development",
        input_json={"question": "source stays"}, expected_json={"answer": "ground truth stays"},
        context_json={"secret": "immutable evidence stays"}, tags_json=[],
    )
    target = TargetAdapterRecord(workspace_id=workspace.id, name="local", kind="bundled")
    db.add_all([case, target])
    db.flush()
    config_a = CandidateConfig(workspace_id=workspace.id, name="A", target_id=target.id,
                               model_id="fixture", prompt="prompt A", options_json={})
    config_b = CandidateConfig(workspace_id=workspace.id, name="B", target_id=target.id,
                               model_id="fixture", prompt="prompt B", options_json={})
    db.add_all([config_a, config_b])
    db.flush()
    experiment = Experiment(
        workspace_id=workspace.id, name="private experiment", dataset_version_id=version.id,
        candidate_a_id=config_a.id, candidate_b_id=config_b.id, status=status,
        selection_json=[case.id], repetitions=1, created_at=timestamp,
        finished_at=timestamp if status == "completed" else None,
        failure_reason="private failure text",
    )
    db.add(experiment)
    db.flush()
    run_a = CaseRun(
        workspace_id=workspace.id, experiment_id=experiment.id, case_id=case.id,
        candidate_label="A", status="completed" if status == "completed" else "running",
        output_json={"answer": "sensitive output"}, cost_usd=0.2, latency_ms=12,
        finished_at=timestamp if status == "completed" else None,
    )
    run_b = CaseRun(
        workspace_id=workspace.id, experiment_id=experiment.id, case_id=case.id,
        candidate_label="B", status="failed" if status == "completed" else "pending",
        error_category="target_error", error_message="sensitive error",
        finished_at=timestamp if status == "completed" else None,
    )
    db.add_all([run_a, run_b])
    db.flush()
    db.add_all([
        Score(case_run_id=run_a.id, metric_key="normalized_match", value=1.0,
              applicable=True, detail_json={"raw": "sensitive score detail"}),
        Score(case_run_id=run_b.id, metric_key="normalized_match", value=0.0,
              applicable=True, detail_json={"raw": "sensitive score detail"}),
        Job(workspace_id=workspace.id, experiment_id=experiment.id, status=job_status),
        Event(workspace_id=workspace.id, experiment_id=experiment.id, case_run_id=run_a.id,
              kind="provider_secret_in_kind", payload_json={"secret": "event payload"}, created_at=timestamp),
        Artifact(workspace_id=workspace.id, experiment_id=experiment.id, kind="report",
                 content_json={"private": "artifact body"}, created_at=timestamp),
    ])
    review = ReviewAssignment(
        workspace_id=workspace.id, experiment_id=experiment.id, case_id=case.id,
        case_run_a_id=run_a.id, case_run_b_id=run_b.id,
        side_map_json={"left": "A", "right": "B"}, status="adjudicated",
        adjudication_json={"label": "left", "score": 4, "notes": "sensitive adjudication",
                           "reviewer_id": "local-reviewer", "created_at": timestamp.isoformat()},
        created_at=timestamp,
    )
    db.add(review)
    db.flush()
    db.add(ReviewDecision(assignment_id=review.id, reviewer_id="local-reviewer",
                          label="left", score=4, notes="sensitive review", created_at=timestamp))
    db.flush()
    return workspace, experiment, run_a, run_b, case


def test_workspace_redaction_is_dry_run_scoped_and_idempotent(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'retention.db').as_posix()}")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    old = datetime.now(timezone.utc) - timedelta(days=90)
    recent = datetime.now(timezone.utc) - timedelta(days=5)
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    with sessions.begin() as db:
        workspace, experiment, run_a, run_b, case = _scenario(db, "selected", status="completed", timestamp=old)
        _, other_experiment, other_run, _, _ = _scenario(db, "other", status="completed", timestamp=old)
        _, active_experiment, active_run, _, _ = _scenario(db, "active", status="running", timestamp=old, job_status="running")
        # A fresh terminal experiment in the selected workspace must remain untouched.
        fresh = Experiment(
            workspace_id=workspace.id, name="fresh", dataset_version_id=experiment.dataset_version_id,
            candidate_a_id=experiment.candidate_a_id, candidate_b_id=experiment.candidate_b_id,
            status="completed", selection_json=[case.id], repetitions=1,
            created_at=recent, finished_at=recent,
        )
        db.add(fresh)
        db.flush()
        fresh_run = CaseRun(workspace_id=workspace.id, experiment_id=fresh.id, case_id=case.id,
                            candidate_label="A", status="completed", output_json={"answer": "recent"}, finished_at=recent)
        db.add(fresh_run)
        db.flush()
        selected_workspace_id = workspace.id
        selected_experiment_id = experiment.id
        selected_run_a_id, selected_run_b_id = run_a.id, run_b.id
        case_id = case.id
        other_run_id, active_run_id, fresh_run_id = other_run.id, active_run.id, fresh_run.id
        other_experiment_id, active_experiment_id = other_experiment.id, active_experiment.id

    with sessions() as db:
        preview = redact_workspace(db, selected_workspace_id, cutoff)
        assert preview["mode"] == "dry_run"
        assert preview["experiment_ids"] == [selected_experiment_id]
        assert preview["counts"]["outputs"] == 1
        assert preview["counts"]["error_messages"] == 1
        assert preview["counts"]["events"] == 1
        assert preview["counts"]["score_details"] == 2
        assert db.get(CaseRun, selected_run_a_id).output_json == {"answer": "sensitive output"}
        with pytest.raises(ValueError, match="confirm-workspace-id"):
            redact_workspace(db, selected_workspace_id, cutoff, apply=True, confirm_workspace_id="wrong")

    with sessions.begin() as db:
        applied = redact_workspace(db, selected_workspace_id, cutoff, apply=True,
                                   confirm_workspace_id=selected_workspace_id)
        assert applied["counts"] == preview["counts"]
    with sessions() as db:
        selected_a = db.get(CaseRun, selected_run_a_id)
        selected_b = db.get(CaseRun, selected_run_b_id)
        assert selected_a.output_json is None and selected_a.status == "completed"
        assert selected_a.cost_usd == 0.2 and selected_a.latency_ms == 12
        assert selected_b.error_message is None and selected_b.error_category == "target_error"
        scores = db.scalars(select(Score).where(Score.case_run_id.in_([selected_run_a_id, selected_run_b_id]))).all()
        assert sorted(score.value for score in scores) == [0.0, 1.0]
        assert all(score.detail_json == {"redacted": True} for score in scores)
        review = db.scalar(select(ReviewAssignment).where(ReviewAssignment.experiment_id == selected_experiment_id))
        assert review.adjudication_json["label"] == "left"
        assert "notes" not in review.adjudication_json
        decision = db.scalar(select(ReviewDecision).where(ReviewDecision.assignment_id == review.id))
        assert decision.notes == "" and decision.label == "left" and decision.score == 4
        events = db.scalars(select(Event).where(Event.experiment_id == selected_experiment_id)).all()
        assert len(events) == 1 and events[0].kind == "redacted_event"
        assert events[0].payload_json == {"redacted": True}
        artifacts = db.scalars(select(Artifact).where(Artifact.experiment_id == selected_experiment_id)).all()
        audit = next(item for item in artifacts if item.kind == REDACTION_KIND)
        assert audit.content_json["counts"] == preview["counts"]
        assert all(item.content_json == {"redacted": True} for item in artifacts if item.id != audit.id)
        assert db.get(Case, case_id).expected_json == {"answer": "ground truth stays"}
        assert db.get(Case, case_id).context_json == {"secret": "immutable evidence stays"}
        assert db.get(CaseRun, other_run_id).output_json == {"answer": "sensitive output"}
        assert db.get(CaseRun, active_run_id).output_json == {"answer": "sensitive output"}
        assert db.get(CaseRun, fresh_run_id).output_json == {"answer": "recent"}
        assert db.get(Experiment, other_experiment_id).status == "completed"
        assert db.get(Experiment, active_experiment_id).status == "running"
        assert redact_workspace(db, selected_workspace_id, cutoff)["counts"]["experiments"] == 0
    engine.dispose()


def test_cli_requires_explicit_cutoff_and_confirmation_on_isolated_db(tmp_path, monkeypatch, capsys):
    engine = create_engine(f"sqlite:///{(tmp_path / 'cli-retention.db').as_posix()}")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    old = datetime.now(timezone.utc) - timedelta(days=90)
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    with sessions.begin() as db:
        workspace, experiment, run_a, _, _ = _scenario(db, "cli", status="completed", timestamp=old)
        workspace_id, experiment_id, run_id = workspace.id, experiment.id, run_a.id
    monkeypatch.setattr(cli, "SessionLocal", sessions)
    base = ["evalboard", "redact", "--workspace-id", workspace_id, "--before", cutoff.isoformat()]
    monkeypatch.setattr(sys, "argv", base)
    assert cli.main() == 0
    assert json.loads(capsys.readouterr().out)["mode"] == "dry_run"
    with sessions() as db:
        assert db.get(CaseRun, run_id).output_json is not None
    monkeypatch.setattr(sys, "argv", base + ["--apply"])
    assert cli.main() == 2
    assert "confirm-workspace-id" in capsys.readouterr().err
    with sessions() as db:
        assert db.get(CaseRun, run_id).output_json is not None
    monkeypatch.setattr(sys, "argv", base + ["--apply", "--confirm-workspace-id", workspace_id])
    assert cli.main() == 0
    assert json.loads(capsys.readouterr().out)["experiment_ids"] == [experiment_id]
    with sessions() as db:
        assert db.get(CaseRun, run_id).output_json is None
    with pytest.raises(ValueError, match="timezone"):
        parse_cutoff("2026-01-01T00:00:00")
    with pytest.raises(ValueError, match="future"):
        parse_cutoff((datetime.now(timezone.utc) + timedelta(days=1)).isoformat())
    engine.dispose()
