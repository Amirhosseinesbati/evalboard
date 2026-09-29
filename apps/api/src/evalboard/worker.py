"""Lease-backed experiment worker. Graph checkpoints and case outputs survive restarts."""

import hashlib
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
from typing_extensions import TypedDict

from evalboard.analysis import compare, report
from evalboard.config import get_settings
from evalboard.db import SessionLocal
from evalboard.evaluators import evaluate
from evalboard.models import (
    CandidateConfig,
    Case,
    CaseRun,
    Event,
    Experiment,
    Job,
    ReviewAssignment,
    Score,
    TargetAdapterRecord,
    now,
)
from evalboard.targets import (
    PermanentTargetError,
    TransientTargetError,
    UncertainTargetError,
    adapter_for,
    valid_nonnegative_number,
)

logger = logging.getLogger(__name__)


class RunState(TypedDict):
    case_run_id: str
    workspace_id: str
    job_id: str
    worker_owner: str
    stage: str


class ExperimentState(TypedDict):
    experiment_id: str
    workspace_id: str
    job_id: str
    worker_owner: str
    phase: str
    batch_run_ids: list[str]
    concurrency: int


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _event(db: Session, experiment: Experiment, kind: str, payload: dict, case_run_id: str | None = None) -> None:
    db.add(Event(
        workspace_id=experiment.workspace_id,
        experiment_id=experiment.id,
        case_run_id=case_run_id,
        kind=kind,
        payload_json=payload,
    ))


def _save_scores(db: Session, case: Case, run: CaseRun) -> None:
    existing = {s.metric_key for s in db.scalars(select(Score).where(Score.case_run_id == run.id))}
    for item in evaluate(case, run):
        if item["metric_key"] not in existing:
            db.add(Score(
                case_run_id=run.id,
                metric_key=item["metric_key"],
                value=item["value"],
                applicable=item["applicable"],
                detail_json=item["detail"],
            ))


def _case_context(db: Session, case_run_id: str, workspace_id: str) -> tuple[CaseRun, Case, Experiment]:
    run = db.get(CaseRun, case_run_id)
    if not run or run.workspace_id != workspace_id:
        raise ValueError("case run not found in workspace")
    case = db.get(Case, run.case_id)
    experiment = db.get(Experiment, run.experiment_id)
    if not case or not experiment or case.workspace_id != workspace_id or experiment.workspace_id != workspace_id:
        raise ValueError("case or experiment not found in workspace")
    return run, case, experiment


def _validate(state: RunState) -> dict:
    with SessionLocal() as db:
        run, _case, experiment = _case_context(db, state["case_run_id"], state["workspace_id"])
        if experiment.status in ("cancelled", "paused") or run.status in ("completed", "failed", "uncertain", "cancelled"):
            return {"stage": "skip"}
    return {"stage": "ready"}


def _infer(state: RunState) -> dict:
    if state["stage"] == "skip":
        return {"stage": "skip"}
    with SessionLocal() as db:
        run, case, experiment = _case_context(db, state["case_run_id"], state["workspace_id"])
        if run.output_json is not None:
            return {"stage": "output_saved"}
        config_id = experiment.candidate_a_id if run.candidate_label == "A" else experiment.candidate_b_id
        config = db.get(CandidateConfig, config_id)
        if not config or config.workspace_id != state["workspace_id"]:
            raise ValueError("candidate config not found in workspace")
        target = db.get(TargetAdapterRecord, config.target_id)
        if not target or target.workspace_id != state["workspace_id"]:
            raise ValueError("target not found in workspace")
        if run.status != "running":
            run.status = "running"
            run.started_at = now()
            if run.started_at and experiment.created_at:
                run.queue_wait_ms = max(0, (_utc(run.started_at) - _utc(experiment.created_at)).total_seconds() * 1000)
            _event(db, experiment, "case_started", {"candidate_label": run.candidate_label, "case_key": case.case_key}, run.id)
            db.commit()
        adapter = adapter_for(target)
        case_key, input_data, context = case.case_key, case.input_json, case.context_json

    error: Exception | None = None
    result = None
    for attempt in range(3):
        with SessionLocal.begin() as db:
            attempt_run = db.get(CaseRun, state["case_run_id"])
            if attempt_run:
                attempt_run.attempt_count += 1
        try:
            result = adapter.run(case_key, input_data, context, config, idempotency_key=state["case_run_id"])
            break
        except UncertainTargetError as exc:
            error = exc
            break
        except TransientTargetError as exc:
            error = exc
            if attempt < 2:
                time.sleep(0.25 * (2**attempt))
        except PermanentTargetError as exc:
            error = exc
            break
        except Exception as exc:
            error = exc
            break

    with SessionLocal() as db:
        run, _case, experiment = _case_context(db, state["case_run_id"], state["workspace_id"])
        job = db.get(Job, state["job_id"])
        lease_valid = bool(
            job
            and job.lease_owner == state["worker_owner"]
            and job.lease_until
            and _utc(job.lease_until) > now()
            and run.status == "running"
        )
        if not lease_valid:
            # An expired lease may have been recovered by another worker.
            # Never overwrite its uncertain outcome with a late response.
            return {"stage": "skip"}
        if result:
            # Output is committed before scoring; a crash after this point only reruns scoring.
            run.output_json = result.output
            run.latency_ms = result.latency_ms
            run.input_tokens = result.input_tokens
            run.output_tokens = result.output_tokens
            run.cost_usd = result.cost_usd
            run.status = "output_saved"
            for item in result.events[:20]:
                _event(db, experiment, str(item.get("kind", "target_event")), item, run.id)
            _event(db, experiment, "case_output_saved", {"candidate_label": run.candidate_label}, run.id)
        else:
            run.status = "uncertain" if isinstance(error, UncertainTargetError) else "failed"
            if isinstance(error, UncertainTargetError):
                run.error_category = "timeout_uncertain" if "timeout" in str(error).lower() else "uncertain_inference"
            else:
                run.error_category = "timeout" if error and "timeout" in str(error).lower() else "target_error"
            run.error_message = str(error)[:400] if error else "target returned no result"
            run.latency_ms = (now() - _utc(run.started_at)).total_seconds() * 1000 if run.started_at else None
            _event(db, experiment, "case_failed", {"category": run.error_category}, run.id)
        db.commit()
    return {"stage": "output_saved" if result else "failed"}


def _score(state: RunState) -> dict:
    if state["stage"] == "skip":
        return {"stage": "skip"}
    with SessionLocal() as db:
        run, case, experiment = _case_context(db, state["case_run_id"], state["workspace_id"])
        if run.status == "output_saved":
            run.status = "completed"
        if run.status in ("completed", "failed", "uncertain", "cancelled"):
            _save_scores(db, case, run)
            run.finished_at = now()
            _event(db, experiment, "case_scored", {"status": run.status}, run.id)
            db.commit()
    return {"stage": "scored"}


def build_case_graph(checkpointer):
    graph = StateGraph(RunState)
    graph.add_node("validate", _validate)
    graph.add_node("infer", _infer)
    graph.add_node("score", _score)
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "infer")
    graph.add_edge("infer", "score")
    graph.add_edge("score", END)
    return graph.compile(checkpointer=checkpointer)


@contextmanager
def checkpoint_saver():
    settings = get_settings()
    if settings.is_sqlite:
        from langgraph.checkpoint.sqlite import SqliteSaver

        path = settings.database_url.removeprefix("sqlite:///")
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with SqliteSaver.from_conn_string(path) as saver:
            saver.setup()
            yield saver
    else:
        from langgraph.checkpoint.postgres import PostgresSaver

        dsn = settings.database_url.replace("postgresql+psycopg://", "postgresql://", 1)
        with PostgresSaver.from_conn_string(dsn) as saver:
            saver.setup()
            yield saver


def claim_job(owner: str) -> str | None:
    now_utc = now()
    with SessionLocal.begin() as db:
        query = select(Job).where(
            (Job.status.in_(["queued", "review_ready"])) | ((Job.status == "running") & (Job.lease_until < now_utc))
        ).order_by(Job.id)
        if db.bind and db.bind.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)
        job = db.scalar(query.limit(1))
        if not job:
            return None
        recovered = job.status == "running"
        review_resume = job.status == "review_ready"
        claimed = db.execute(
            update(Job)
            .where(
                Job.id == job.id,
                (Job.status.in_(["queued", "review_ready"])) | ((Job.status == "running") & (Job.lease_until < now_utc)),
            )
            .values(
                status="running",
                lease_owner=owner,
                lease_until=now_utc + timedelta(seconds=get_settings().worker_lease_seconds),
                attempts=Job.attempts + 1,
            )
            .execution_options(synchronize_session=False)
        )
        if getattr(claimed, "rowcount", 0) != 1:
            return None
        db.refresh(job)
        experiment = db.get(Experiment, job.experiment_id)
        if not experiment:
            job.status = "failed"
            return None
        if experiment.status != "review_pending":
            experiment.status = "running"
        if not experiment.started_at:
            experiment.started_at = now_utc
        event_kind = "job_recovered" if recovered else "review_resume_claimed" if review_resume else "job_started"
        _event(db, experiment, event_kind, {"attempt": job.attempts})
        if recovered:
            # Inference may have reached a provider but not committed its output.
            for run in db.scalars(select(CaseRun).where(CaseRun.experiment_id == experiment.id, CaseRun.status == "running")).all():
                run.status = "uncertain"
                run.error_category = "uncertain_inference"
                run.error_message = "Worker lease expired during inference; external completion is unknown."
                case = db.get(Case, run.case_id)
                if case:
                    _save_scores(db, case, run)
                _event(db, experiment, "case_uncertain", {}, run.id)
        return job.id


def _renew_job(db: Session, job: Job, owner: str) -> None:
    if job.lease_owner != owner:
        raise RuntimeError("worker lost job lease")
    job.lease_until = now() + timedelta(seconds=get_settings().worker_lease_seconds)
    db.commit()


def _create_review_sample(db: Session, experiment: Experiment) -> int:
    if db.scalar(select(ReviewAssignment.id).where(ReviewAssignment.experiment_id == experiment.id)):
        return 0
    cases = db.scalars(select(Case).where(Case.dataset_version_id == experiment.dataset_version_id)).all()
    selected_ids = set(experiment.selection_json or [])
    selected = [
        case for case in cases
        if case.id in selected_ids and case.task_type in ("grounded_qa", "adversarial")
    ][:6]
    count = 0
    for case in selected:
        pair = db.scalars(select(CaseRun).where(
            CaseRun.experiment_id == experiment.id,
            CaseRun.case_id == case.id,
            CaseRun.repetition == 1,
        )).all()
        by_label = {run.candidate_label: run for run in pair}
        if "A" not in by_label or "B" not in by_label:
            continue
        digest = hashlib.sha256(f"{experiment.id}:{case.id}".encode()).digest()
        mapping = {"left": "A", "right": "B"} if digest[0] % 2 else {"left": "B", "right": "A"}
        db.add(ReviewAssignment(
            workspace_id=experiment.workspace_id,
            experiment_id=experiment.id,
            case_id=case.id,
            case_run_a_id=by_label["A"].id,
            case_run_b_id=by_label["B"].id,
            side_map_json=mapping,
        ))
        count += 1
    return count


def _reserved_cost(db: Session, experiment: Experiment, run: CaseRun) -> float | None:
    if run.status == "output_saved":
        return 0.0
    config_id = experiment.candidate_a_id if run.candidate_label == "A" else experiment.candidate_b_id
    config = db.get(CandidateConfig, config_id)
    target = db.get(TargetAdapterRecord, config.target_id) if config else None
    if not config or not target:
        return None
    if target.kind == "bundled":
        return 0.0
    if target.kind == "recorded":
        case = db.get(Case, run.case_id)
        record = (target.recorded_outputs_json or {}).get(case.case_key) if case else None
        if not isinstance(record, dict) or record.get("cost_usd") is None:
            return None
        try:
            return valid_nonnegative_number(record["cost_usd"])
        except PermanentTargetError:
            return None
    options = config.options_json
    prices = options.get("prices_per_million_tokens", {})
    if not all(key in prices for key in ("input", "output")):
        return None
    input_cap = options.get("max_input_tokens")
    output_cap = options.get("max_output_tokens")
    if not isinstance(input_cap, int) or not isinstance(output_cap, int):
        return None
    return (input_cap * float(prices["input"]) + output_cap * float(prices["output"])) / 1_000_000


def _stop_pending_for_budget(db: Session, experiment: Experiment, category: str, message: str,
                             candidate_label: str | None = None) -> None:
    query = select(CaseRun).where(CaseRun.experiment_id == experiment.id, CaseRun.status == "pending")
    if candidate_label:
        query = query.where(CaseRun.candidate_label == candidate_label)
    for run in db.scalars(query).all():
        run.status = "failed"
        run.error_category = category
        run.error_message = message
        case = db.get(Case, run.case_id)
        if case:
            _save_scores(db, case, run)
    experiment.failure_reason = message
    _event(db, experiment, category, {"reason": message})


def _lifecycle_schedule(state: ExperimentState) -> dict:
    """Choose one bounded batch and reserve budget under the SQL job lease."""
    with SessionLocal() as db:
        job = db.get(Job, state["job_id"])
        if not job or job.lease_owner != state["worker_owner"]:
            return {"phase": "end", "batch_run_ids": []}
        experiment = db.get(Experiment, state["experiment_id"])
        if not experiment or experiment.workspace_id != state["workspace_id"]:
            return {"phase": "end", "batch_run_ids": []}
        if experiment.status == "cancelled":
            for run in db.scalars(select(CaseRun).where(CaseRun.experiment_id == experiment.id, CaseRun.status == "pending")).all():
                run.status = "cancelled"
                case = db.get(Case, run.case_id)
                if case:
                    _save_scores(db, case, run)
            job.status = "cancelled"
            _event(db, experiment, "job_cancelled", {})
            db.commit()
            return {"phase": "end", "batch_run_ids": []}
        if experiment.status == "paused":
            job.status = "paused"
            _event(db, experiment, "job_paused", {})
            db.commit()
            return {"phase": "end", "batch_run_ids": []}
        pending = db.scalars(select(CaseRun).where(
            CaseRun.experiment_id == experiment.id,
            CaseRun.status.in_(["pending", "output_saved"]),
        ).order_by(CaseRun.id)).all()
        if not pending:
            return {"phase": "aggregate", "batch_run_ids": []}
        config_a = db.get(CandidateConfig, experiment.candidate_a_id)
        config_b = db.get(CandidateConfig, experiment.candidate_b_id)
        configs = {"A": config_a, "B": config_b}
        budgeted = experiment.budget_usd is not None or any(
            config is not None and config.budget_usd is not None for config in configs.values()
        )
        concurrency = 1 if budgeted else min(config_a.concurrency if config_a else 1, config_b.concurrency if config_b else 1, 8)
        ready_to_score = [run for run in pending if run.status == "output_saved"]
        batch = ready_to_score[:concurrency] if ready_to_score else pending[:concurrency]
        if budgeted and not ready_to_score:
            run = batch[0]
            current_config = configs[run.candidate_label]
            scopes = [(None, experiment.budget_usd), (run.candidate_label, current_config.budget_usd if current_config else None)]
            reserve = _reserved_cost(db, experiment, run)
            for label, cap in scopes:
                if cap is None:
                    continue
                scope_filter = [CaseRun.experiment_id == experiment.id]
                if label:
                    scope_filter.append(CaseRun.candidate_label == label)
                uncertain_cost = False
                for candidate_label, config in configs.items():
                    if not config or (label and label != candidate_label):
                        continue
                    target = db.get(TargetAdapterRecord, config.target_id)
                    if target and target.kind != "bundled":
                        uncertain_cost = db.scalar(select(CaseRun.id).where(
                            CaseRun.experiment_id == experiment.id,
                            CaseRun.candidate_label == candidate_label,
                            CaseRun.status.in_(["completed", "failed", "uncertain"]),
                            CaseRun.cost_usd.is_(None),
                        ).limit(1)) is not None
                    if uncertain_cost:
                        break
                if uncertain_cost or reserve is None:
                    _stop_pending_for_budget(db, experiment, "budget_unknown", "Unknown target cost prevents further inference.", label)
                    db.commit()
                    return {"phase": "aggregate", "batch_run_ids": []}
                raw_spent = db.scalar(select(func.sum(CaseRun.cost_usd)).where(*scope_filter)) or 0.0
                try:
                    spent = valid_nonnegative_number(raw_spent)
                except PermanentTargetError:
                    _stop_pending_for_budget(db, experiment, "budget_unknown", "Invalid recorded cost prevents further inference.", label)
                    db.commit()
                    return {"phase": "aggregate", "batch_run_ids": []}
                if spent + reserve > cap + 1e-12:
                    _stop_pending_for_budget(db, experiment, "budget_exhausted", "Remaining budget cannot reserve the next case.", label)
                    db.commit()
                    return {"phase": "aggregate", "batch_run_ids": []}
        _renew_job(db, job, state["worker_owner"])
        return {"phase": "execute", "batch_run_ids": [run.id for run in batch], "concurrency": concurrency}


def _lifecycle_aggregate(state: ExperimentState) -> dict:
    """Aggregate completed runs and create idempotent blinded review work."""
    with SessionLocal() as db:
        experiment = db.get(Experiment, state["experiment_id"])
        job = db.get(Job, state["job_id"])
        if not experiment or not job or job.lease_owner != state["worker_owner"]:
            return {"phase": "end"}
        if experiment.status in ("cancelled", "paused"):
            return {"phase": "schedule"}
        pending_id = db.scalar(select(CaseRun.id).where(
            CaseRun.experiment_id == experiment.id,
            CaseRun.status.in_(["pending", "output_saved"]),
        ).limit(1))
        if pending_id:
            return {"phase": "schedule"}
        _create_review_sample(db, experiment)
        db.flush()
        assignments = db.scalars(select(ReviewAssignment).where(ReviewAssignment.experiment_id == experiment.id)).all()
        unresolved = any(item.status in ("pending", "disagreement") for item in assignments)
        if assignments:
            experiment.status = "review_pending"
        if not db.scalar(select(Event.id).where(Event.experiment_id == experiment.id, Event.kind == "experiment_aggregated")):
            comparison = compare(db, experiment)
            _event(db, experiment, "experiment_aggregated", {
                "paired_count": comparison["paired_count"],
                "denominator": comparison["denominator"],
                "reviews": len(assignments),
            })
        db.commit()
        return {"phase": "review" if unresolved else "finalize"}


def _lifecycle_review(state: ExperimentState) -> dict:
    """Persist a real LangGraph interrupt until review decisions exist in SQL."""
    with SessionLocal() as db:
        assignments = db.scalars(select(ReviewAssignment).where(
            ReviewAssignment.experiment_id == state["experiment_id"],
        )).all()
        unresolved_ids = [item.id for item in assignments if item.status in ("pending", "disagreement")]
    interrupt({"kind": "blinded_adjudication", "experiment_id": state["experiment_id"], "assignment_ids": unresolved_ids})
    with SessionLocal() as db:
        still_open = db.scalar(select(ReviewAssignment.id).where(
            ReviewAssignment.experiment_id == state["experiment_id"],
            ReviewAssignment.status.in_(["pending", "disagreement"]),
        ).limit(1))
        job = db.get(Job, state["job_id"])
        owner = job.lease_owner if job else None
    if not owner:
        raise RuntimeError("review resume has no active SQL job lease")
    return {"phase": "review" if still_open else "finalize", "worker_owner": owner}


def _lifecycle_finalize(state: ExperimentState) -> dict:
    """Commit the terminal experiment and release decision after review."""
    with SessionLocal() as db:
        job = db.get(Job, state["job_id"])
        experiment = db.get(Experiment, state["experiment_id"])
        if not job or not experiment or job.lease_owner != state["worker_owner"]:
            return {"phase": "end"}
        if job.status == "completed":
            return {"phase": "end"}
        experiment.status = "completed"
        experiment.finished_at = now()
        db.flush()
        decision = report(db, experiment)["decision"]
        job.status = "completed"
        job.lease_owner = None
        job.lease_until = None
        review_count = db.scalar(select(func.count(ReviewAssignment.id)).where(
            ReviewAssignment.experiment_id == experiment.id,
        )) or 0
        _event(db, experiment, "job_completed", {"review_assignments": review_count, "decision": decision})
        db.commit()
        return {"phase": "end"}


def build_experiment_graph(checkpointer):
    case_graph = build_case_graph(checkpointer)

    def execute(state: ExperimentState) -> dict:
        with ThreadPoolExecutor(max_workers=state["concurrency"]) as executor:
            futures = [executor.submit(
                case_graph.invoke,
                {
                    "case_run_id": case_run_id,
                    "workspace_id": state["workspace_id"],
                    "job_id": state["job_id"],
                    "worker_owner": state["worker_owner"],
                    "stage": "queued",
                },
                {"configurable": {"thread_id": f"case-run:{case_run_id}"}, "recursion_limit": 8},
            ) for case_run_id in state["batch_run_ids"]]
            for future in as_completed(futures):
                future.result()
        return {"phase": "aggregate", "batch_run_ids": []}

    graph = StateGraph(ExperimentState)
    graph.add_node("schedule", _lifecycle_schedule)
    graph.add_node("execute", execute)
    graph.add_node("aggregate", _lifecycle_aggregate)
    graph.add_node("review", _lifecycle_review)
    graph.add_node("finalize", _lifecycle_finalize)
    graph.add_edge(START, "schedule")
    graph.add_conditional_edges("schedule", lambda state: state["phase"], {"execute": "execute", "aggregate": "aggregate", "end": END})
    graph.add_edge("execute", "aggregate")
    graph.add_conditional_edges("aggregate", lambda state: state["phase"], {"schedule": "schedule", "review": "review", "finalize": "finalize", "end": END})
    graph.add_conditional_edges("review", lambda state: state["phase"], {"review": "review", "finalize": "finalize"})
    graph.add_edge("finalize", END)
    return graph.compile(checkpointer=checkpointer)


def run_job(job_id: str, owner: str) -> None:
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if not job or job.lease_owner != owner:
            return
        experiment = db.get(Experiment, job.experiment_id)
        if not experiment:
            return
        experiment_id, workspace_id = experiment.id, experiment.workspace_id
        review_resume = experiment.status == "review_pending"
        if review_resume:
            unresolved = db.scalar(select(ReviewAssignment.id).where(
                ReviewAssignment.experiment_id == experiment.id,
                ReviewAssignment.status.in_(["pending", "disagreement"]),
            ).limit(1))
            if unresolved:
                job.status = "waiting_review"
                job.lease_owner = None
                job.lease_until = None
                db.commit()
                return
    initial: ExperimentState = {
        "experiment_id": experiment_id,
        "workspace_id": workspace_id,
        "job_id": job_id,
        "worker_owner": owner,
        "phase": "schedule",
        "batch_run_ids": [],
        "concurrency": 1,
    }
    config = {"configurable": {"thread_id": f"experiment:{experiment_id}"}, "recursion_limit": 10000}
    with checkpoint_saver() as saver:
        graph = build_experiment_graph(saver)
        snapshot = graph.get_state(config) if review_resume else None
        interrupted = bool(snapshot and any(getattr(task, "interrupts", ()) for task in snapshot.tasks))
        result = graph.invoke(Command(resume={"reviewed": True}) if interrupted else initial, config)
    if result.get("__interrupt__"):
        with SessionLocal.begin() as db:
            job = db.get(Job, job_id)
            if job and job.lease_owner == owner:
                unresolved = db.scalar(select(ReviewAssignment.id).where(
                    ReviewAssignment.experiment_id == experiment_id,
                    ReviewAssignment.status.in_(["pending", "disagreement"]),
                ).limit(1))
                job.status = "waiting_review" if unresolved else "review_ready"
                job.lease_owner = None
                job.lease_until = None


def run_once(owner: str | None = None) -> bool:
    owner = owner or uuid4().hex
    job_id = claim_job(owner)
    if not job_id:
        return False
    try:
        run_job(job_id, owner)
    except Exception:
        logger.exception("job failed", extra={"job_id": job_id})
        with SessionLocal.begin() as db:
            job = db.get(Job, job_id)
            if job and job.lease_owner == owner:
                # A new worker can recover it once the lease expires.
                job.lease_until = now() - timedelta(seconds=1)
        return True
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    owner = uuid4().hex
    while True:
        if not run_once(owner):
            time.sleep(get_settings().worker_poll_seconds)


if __name__ == "__main__":
    main()
