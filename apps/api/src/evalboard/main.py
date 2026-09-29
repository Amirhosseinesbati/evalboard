"""Versioned FastAPI surface for datasets, experiments, review, and reports."""

import asyncio
import hashlib
import json
import os
import re
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from evalboard.analysis import compare, report
from evalboard.auth import (
    COOKIE_NAME,
    current_user,
    login,
    require_admin,
    require_review,
    require_write,
    user_public,
)
from evalboard.config import get_settings
from evalboard.dataset import parse_jsonl, version_hash
from evalboard.db import Base, SessionLocal, engine, get_db
from evalboard.evaluators import METRICS
from evalboard.models import (
    CandidateConfig,
    Case,
    CaseRun,
    Dataset,
    DatasetVersion,
    Event,
    Experiment,
    Job,
    LoginSession,
    ReleaseGate,
    ReviewAssignment,
    ReviewDecision,
    Score,
    TargetAdapterRecord,
    User,
    now,
)
from evalboard.report_markdown import render_report_markdown
from evalboard.schemas import (
    CaseEdit,
    ConfigCreate,
    DatasetImport,
    ExperimentCreate,
    GateCreate,
    ReviewInput,
    TargetCreate,
)
from evalboard.seed import seed_demo
from evalboard.targets import (
    PermanentTargetError,
    validate_http_endpoint,
    validate_recorded_outputs,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    if settings.is_sqlite:
        Base.metadata.create_all(engine)
    if settings.evalboard_demo:
        seed_demo()
    yield


app = FastAPI(title="EvalBoard API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in get_settings().cors_origins.split(",") if x.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Last-Event-ID"],
)


@app.middleware("http")
async def reviewer_isolation(request: Request, call_next):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        with SessionLocal() as db:
            session = db.scalar(select(LoginSession).where(LoginSession.token_hash == hashlib.sha256(token.encode()).hexdigest()))
            user = db.get(User, session.user_id) if session else None
            if user and user.role == "reviewer":
                path = request.url.path
                permitted = path.startswith("/api/v1/reviews") or path in {
                    "/api/v1/auth/me", "/api/v1/auth/logout", "/api/v1/auth/login", "/health", "/api/v1/health",
                }
                if not permitted:
                    return JSONResponse({"detail": "Blind reviewer cannot access unblinded resources"}, status_code=403)
    return await call_next(request)


class LoginInput(BaseModel):
    username: str
    password: str


def scoped(db: Session, model, object_id: str, workspace_id: str):
    row = db.get(model, object_id)
    if not row or row.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Resource not found")
    return row


def dataset_public(db: Session, dataset: Dataset) -> dict:
    versions = db.scalars(select(DatasetVersion).where(DatasetVersion.dataset_id == dataset.id).order_by(DatasetVersion.version_number.desc())).all()
    latest = versions[0] if versions else None
    return {
        "id": dataset.id,
        "name": dataset.name,
        "description": dataset.description,
        "latest_version_id": latest.id if latest else None,
        "version_count": len(versions),
        "case_count": latest.case_count if latest else 0,
        "created_at": dataset.created_at,
    }


def version_public(version: DatasetVersion) -> dict:
    return {
        "id": version.id,
        "dataset_id": version.dataset_id,
        "version_number": version.version_number,
        "content_hash": version.content_hash,
        "case_count": version.case_count,
        "created_at": version.created_at,
    }


def case_public(case: Case) -> dict:
    return {
        "id": case.id,
        "case_key": case.case_key,
        "task_type": case.task_type,
        "split": case.split,
        "input": case.input_json,
        "expected": case.expected_json,
        "context": case.context_json,
        "tags": case.tags_json,
    }


def target_public(target: TargetAdapterRecord) -> dict:
    if target.kind in ("bundled", "recorded"):
        connection_status = "ready"
    elif target.kind == "openai":
        connection_status = "configured_unverified" if os.getenv("OPENAI_API_KEY") else "missing_credentials"
    else:
        connection_status = "configured_unverified" if target.endpoint and (not target.secret_ref or os.getenv(target.secret_ref)) else "missing_credentials"
    return {
        "id": target.id,
        "name": target.name,
        "kind": target.kind,
        "endpoint": target.endpoint,
        "has_secret_ref": bool(target.secret_ref),
        "connection_status": connection_status,
        "recorded_case_count": len(target.recorded_outputs_json or {}),
        "created_at": target.created_at,
    }


def config_public(config: CandidateConfig) -> dict:
    return {
        "id": config.id,
        "name": config.name,
        "target_id": config.target_id,
        "model_id": config.model_id,
        "prompt": config.prompt,
        "options": config.options_json,
        "budget_usd": config.budget_usd,
        "concurrency": config.concurrency,
        "created_at": config.created_at,
    }


def experiment_public(db: Session, experiment: Experiment) -> dict:
    runs = db.scalars(select(CaseRun.status).where(CaseRun.experiment_id == experiment.id)).all()
    total = len(runs)
    done = sum(status in ("completed", "failed", "uncertain", "cancelled") for status in runs)
    return {
        "id": experiment.id,
        "name": experiment.name,
        "dataset_version_id": experiment.dataset_version_id,
        "candidate_a_id": experiment.candidate_a_id,
        "candidate_b_id": experiment.candidate_b_id,
        "gate_id": experiment.gate_id,
        "split": experiment.split,
        "repetitions": experiment.repetitions,
        "max_cases": experiment.max_cases,
        "budget_usd": experiment.budget_usd,
        "status": experiment.status,
        "source": experiment.source,
        "progress": done / total if total else 0,
        "total_runs": total,
        "completed_runs": sum(status == "completed" for status in runs),
        "failed_runs": sum(status in ("failed", "uncertain") for status in runs),
        "cancelled_runs": sum(status == "cancelled" for status in runs),
        "failure_reason": experiment.failure_reason,
        "created_at": experiment.created_at,
        "started_at": experiment.started_at,
        "finished_at": experiment.finished_at,
    }


def result_public(db: Session, run: CaseRun, case: Case) -> dict:
    scores = db.scalars(select(Score).where(Score.case_run_id == run.id)).all()
    events = db.scalars(select(Event).where(Event.case_run_id == run.id).order_by(Event.created_at)).all()
    return {
        "id": run.id,
        "case_id": case.id,
        "case_key": case.case_key,
        "task_type": case.task_type,
        "split": case.split,
        "input": case.input_json,
        "expected": case.expected_json,
        "context": case.context_json,
        "candidate_label": run.candidate_label,
        "repetition": run.repetition,
        "status": run.status,
        "output": run.output_json,
        "error_category": run.error_category,
        "error_message": run.error_message,
        "latency_ms": run.latency_ms,
        "queue_wait_ms": run.queue_wait_ms,
        "input_tokens": run.input_tokens,
        "output_tokens": run.output_tokens,
        "cost_usd": run.cost_usd,
        "scores": [{
            "metric_key": score.metric_key,
            "value": score.value,
            "applicable": score.applicable,
            "unit": next((m.unit for m in METRICS if m.key == score.metric_key), ""),
            "direction": next((m.direction for m in METRICS if m.key == score.metric_key), ""),
        } for score in scores],
        "events": [{"kind": item.kind, "payload": item.payload_json, "created_at": item.created_at} for item in events],
    }


def review_public(db: Session, assignment: ReviewAssignment, requester: User,
                  include_identity: bool = False) -> dict:
    case = db.get(Case, assignment.case_id)
    a = db.get(CaseRun, assignment.case_run_a_id)
    b = db.get(CaseRun, assignment.case_run_b_id)
    by_label = {"A": a, "B": b}
    left = by_label[assignment.side_map_json["left"]]
    right = by_label[assignment.side_map_json["right"]]
    decisions = db.scalars(select(ReviewDecision).where(ReviewDecision.assignment_id == assignment.id)).all()
    can_see_decisions = include_identity or assignment.status == "adjudicated" or any(d.reviewer_id == requester.id for d in decisions)
    result = {
        "id": assignment.id,
        "experiment_id": assignment.experiment_id,
        "case_key": case.case_key if case else "",
        "task_type": case.task_type if case else "",
        "prompt": (case.input_json.get("question") or case.input_json.get("text")) if case else "",
        "evidence": case.context_json if case else {},
        "output_left": left.output_json if left else None,
        "output_right": right.output_json if right else None,
        "status_left": left.status if left else "missing",
        "status_right": right.status if right else "missing",
        "side_map_hidden": not include_identity,
        "status": assignment.status,
        "decisions": [{"id": d.id, "label": d.label, "score": d.score, "notes": d.notes, "created_at": d.created_at} for d in decisions] if can_see_decisions else [],
        "adjudication": assignment.adjudication_json if can_see_decisions else None,
    }
    if include_identity:
        result["side_map"] = assignment.side_map_json
    return result


def _add_cases(db: Session, workspace_id: str, version: DatasetVersion, payloads: list[dict]) -> None:
    db.add_all([Case(
        workspace_id=workspace_id,
        dataset_version_id=version.id,
        case_key=payload["case_key"],
        task_type=payload["task_type"],
        split=payload["split"],
        input_json=payload["input"],
        expected_json=payload["expected"],
        context_json=payload["context"],
        tags_json=payload["tags"],
    ) for payload in payloads])


@app.get("/health")
@app.get("/api/v1/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "mode": "demo" if get_settings().evalboard_demo else "connected", "database": "sqlite" if get_settings().is_sqlite else "postgresql"}


@app.post("/api/v1/auth/login")
def auth_login(payload: LoginInput, response: Response, db: Session = Depends(get_db)):
    user = login(db, payload.username, payload.password, response)
    return {"user": user_public(db, user)}


@app.get("/api/v1/auth/me")
def auth_me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"user": user_public(db, user)}


@app.post("/api/v1/auth/logout")
def auth_logout(response: Response, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    token = request.cookies.get(COOKIE_NAME, "")
    hashed = hashlib.sha256(token.encode()).hexdigest()
    record = db.scalar(select(LoginSession).where(LoginSession.token_hash == hashed, LoginSession.user_id == user.id))
    if record:
        db.delete(record)
        db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/v1/datasets")
def list_datasets(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Dataset).where(Dataset.workspace_id == user.workspace_id).order_by(Dataset.created_at.desc())).all()
    return {"items": [dataset_public(db, row) for row in rows]}


@app.post("/api/v1/datasets/import", status_code=201)
def import_dataset(payload: DatasetImport, user: User = Depends(require_write), db: Session = Depends(get_db)):
    if len(payload.jsonl.encode()) > get_settings().max_import_bytes:
        raise HTTPException(status_code=413, detail="JSONL exceeds configured size limit")
    cases, errors = parse_jsonl(payload.jsonl)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})
    serialized = [case.model_dump() for case in cases]
    dataset = Dataset(workspace_id=user.workspace_id, name=payload.name, description=payload.description)
    db.add(dataset)
    db.flush()
    version = DatasetVersion(
        workspace_id=user.workspace_id,
        dataset_id=dataset.id,
        version_number=1,
        content_hash=version_hash(serialized),
        case_count=len(serialized),
    )
    db.add(version)
    db.flush()
    _add_cases(db, user.workspace_id, version, serialized)
    db.commit()
    return {"dataset": dataset_public(db, dataset), "version": version_public(version)}


@app.post("/api/v1/datasets/import/file", status_code=201)
async def import_dataset_file(file: UploadFile, name: str, user: User = Depends(require_write), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith(".jsonl"):
        raise HTTPException(status_code=422, detail="Only .jsonl uploads are supported")
    content = await file.read(get_settings().max_import_bytes + 1)
    if len(content) > get_settings().max_import_bytes:
        raise HTTPException(status_code=413, detail="JSONL exceeds configured size limit")
    try:
        text_content = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail="JSONL must be UTF-8") from exc
    return import_dataset(DatasetImport(name=name, jsonl=text_content), user, db)


@app.get("/api/v1/datasets/{dataset_id}")
def get_dataset(dataset_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return dataset_public(db, scoped(db, Dataset, dataset_id, user.workspace_id))


@app.get("/api/v1/datasets/{dataset_id}/versions")
def list_versions(dataset_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    scoped(db, Dataset, dataset_id, user.workspace_id)
    versions = db.scalars(select(DatasetVersion).where(DatasetVersion.dataset_id == dataset_id).order_by(DatasetVersion.version_number.desc())).all()
    return {"items": [version_public(v) for v in versions]}


@app.get("/api/v1/datasets/{dataset_id}/versions/{version_id}/cases")
def list_cases(dataset_id: str, version_id: str, split: str | None = None, task_type: str | None = None,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    scoped(db, Dataset, dataset_id, user.workspace_id)
    version = scoped(db, DatasetVersion, version_id, user.workspace_id)
    if version.dataset_id != dataset_id:
        raise HTTPException(status_code=404, detail="Version not found in dataset")
    query = select(Case).where(Case.dataset_version_id == version.id)
    if split:
        query = query.where(Case.split == split)
    if task_type:
        query = query.where(Case.task_type == task_type)
    cases = db.scalars(query.order_by(Case.case_key)).all()
    return {"items": [case_public(c) for c in cases], "total": len(cases), "version": version_public(version)}


@app.post("/api/v1/datasets/{dataset_id}/versions/{version_id}/cases/{case_id}/edit", status_code=201)
def edit_case(dataset_id: str, version_id: str, case_id: str, payload: CaseEdit,
              user: User = Depends(require_write), db: Session = Depends(get_db)):
    scoped(db, Dataset, dataset_id, user.workspace_id)
    version = scoped(db, DatasetVersion, version_id, user.workspace_id)
    if version.dataset_id != dataset_id:
        raise HTTPException(status_code=404, detail="Version not found in dataset")
    old_cases = db.scalars(select(Case).where(Case.dataset_version_id == version_id).order_by(Case.case_key)).all()
    if not any(c.id == case_id for c in old_cases):
        raise HTTPException(status_code=404, detail="Case not found")
    if payload.case.case_key != next(c.case_key for c in old_cases if c.id == case_id) and any(c.case_key == payload.case.case_key for c in old_cases):
        raise HTTPException(status_code=422, detail="case_key already exists in this version")
    serialized = [payload.case.model_dump() if c.id == case_id else {k: v for k, v in case_public(c).items() if k != "id"} for c in old_cases]
    next_number = db.scalar(select(func.max(DatasetVersion.version_number)).where(DatasetVersion.dataset_id == dataset_id)) or 0
    new_version = DatasetVersion(
        workspace_id=user.workspace_id,
        dataset_id=dataset_id,
        version_number=next_number + 1,
        content_hash=version_hash(serialized),
        case_count=len(serialized),
    )
    db.add(new_version)
    db.flush()
    _add_cases(db, user.workspace_id, new_version, serialized)
    db.commit()
    return {"version": version_public(new_version)}


@app.get("/api/v1/targets")
def list_targets(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(TargetAdapterRecord).where(TargetAdapterRecord.workspace_id == user.workspace_id)).all()
    return {"items": [target_public(t) for t in rows]}


@app.post("/api/v1/targets", status_code=201)
def create_target(payload: TargetCreate, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    if payload.kind == "http":
        if not payload.endpoint:
            raise HTTPException(status_code=422, detail="HTTP target requires endpoint")
        try:
            validate_http_endpoint(payload.endpoint)
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    if payload.secret_ref and not re.fullmatch(r"EVALBOARD_TARGET_[A-Z0-9_]{1,100}", payload.secret_ref):
        raise HTTPException(status_code=422, detail="secret_ref must be a dedicated EVALBOARD_TARGET_* variable")
    if payload.kind == "recorded" and not payload.recorded_outputs:
        raise HTTPException(status_code=422, detail="recorded target requires case-keyed outputs")
    if payload.kind == "recorded" and payload.recorded_outputs:
        try:
            validate_recorded_outputs(payload.recorded_outputs)
        except PermanentTargetError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    row = TargetAdapterRecord(
        workspace_id=user.workspace_id,
        name=payload.name,
        kind=payload.kind,
        endpoint=payload.endpoint,
        secret_ref=payload.secret_ref,
        recorded_outputs_json=payload.recorded_outputs,
    )
    db.add(row)
    db.commit()
    return target_public(row)


@app.get("/api/v1/configs")
def list_configs(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(CandidateConfig).where(CandidateConfig.workspace_id == user.workspace_id)).all()
    return {"items": [config_public(c) for c in rows]}


@app.post("/api/v1/configs", status_code=201)
def create_config(payload: ConfigCreate, user: User = Depends(require_write), db: Session = Depends(get_db)):
    scoped(db, TargetAdapterRecord, payload.target_id, user.workspace_id)
    row = CandidateConfig(
        workspace_id=user.workspace_id,
        name=payload.name,
        target_id=payload.target_id,
        model_id=payload.model_id,
        prompt=payload.prompt,
        options_json=payload.options,
        budget_usd=payload.budget_usd,
        concurrency=payload.concurrency,
    )
    db.add(row)
    db.commit()
    return config_public(row)


@app.get("/api/v1/gates")
def list_gates(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(ReleaseGate).where(ReleaseGate.workspace_id == user.workspace_id)).all()
    return {"items": [{"id": r.id, "name": r.name, "thresholds": r.thresholds_json} for r in rows]}


@app.post("/api/v1/gates", status_code=201)
def create_gate(payload: GateCreate, user: User = Depends(require_write), db: Session = Depends(get_db)):
    row = ReleaseGate(workspace_id=user.workspace_id, name=payload.name, thresholds_json=payload.thresholds)
    db.add(row)
    db.commit()
    return {"id": row.id, "name": row.name, "thresholds": row.thresholds_json}


@app.get("/api/v1/metrics")
def list_metrics(user: User = Depends(current_user)):
    del user
    return {"items": [{"key": m.key, "label": m.label, "unit": m.unit, "direction": m.direction, "tasks": sorted(m.tasks), "failure_value": m.failure_value} for m in METRICS]}


@app.get("/api/v1/experiments")
def list_experiments(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Experiment).where(Experiment.workspace_id == user.workspace_id).order_by(Experiment.created_at.desc())).all()
    return {"items": [experiment_public(db, row) for row in rows]}


@app.post("/api/v1/experiments", status_code=201)
def create_experiment(payload: ExperimentCreate, user: User = Depends(require_write), db: Session = Depends(get_db)):
    version = scoped(db, DatasetVersion, payload.dataset_version_id, user.workspace_id)
    config_a = scoped(db, CandidateConfig, payload.candidate_a_id, user.workspace_id)
    config_b = scoped(db, CandidateConfig, payload.candidate_b_id, user.workspace_id)
    if config_a.id == config_b.id:
        raise HTTPException(status_code=422, detail="Choose two distinct candidate configurations")
    if payload.gate_id:
        scoped(db, ReleaseGate, payload.gate_id, user.workspace_id)
    targets = [scoped(db, TargetAdapterRecord, config.target_id, user.workspace_id) for config in (config_a, config_b)]
    for config, target in zip((config_a, config_b), targets, strict=True):
        if (payload.budget_usd is not None or config.budget_usd is not None) and target.kind in ("http", "openai"):
            prices = config.options_json.get("prices_per_million_tokens", {})
            if not all(k in prices for k in ("input", "output")) or not all(
                isinstance(config.options_json.get(k), int) and config.options_json[k] > 0
                for k in ("max_input_tokens", "max_output_tokens")
            ):
                raise HTTPException(
                    status_code=422,
                    detail="Budgeted connected target requires token prices and positive max_input_tokens/max_output_tokens",
                )
    target_kinds = {target.kind for target in targets}
    source = (
        "bundled_fixture" if target_kinds == {"bundled"}
        else "recorded_import" if target_kinds == {"recorded"}
        else "connected" if target_kinds <= {"http", "openai"}
        else "mixed"
    )
    query = select(Case).where(Case.dataset_version_id == version.id)
    if payload.split != "all":
        query = query.where(Case.split == payload.split)
    cases = db.scalars(query.order_by(Case.case_key).limit(payload.max_cases)).all()
    if not cases:
        raise HTTPException(status_code=422, detail="No cases match the selected split")
    experiment = Experiment(
        workspace_id=user.workspace_id,
        name=payload.name,
        dataset_version_id=version.id,
        candidate_a_id=config_a.id,
        candidate_b_id=config_b.id,
        split=payload.split,
        max_cases=payload.max_cases,
        selection_json=[case.id for case in cases],
        repetitions=payload.repetitions,
        budget_usd=payload.budget_usd,
        gate_id=payload.gate_id,
        source=source,
    )
    db.add(experiment)
    db.flush()
    db.add_all([
        CaseRun(
            workspace_id=user.workspace_id,
            experiment_id=experiment.id,
            case_id=case.id,
            candidate_label=label,
            repetition=repetition,
        )
        for case in cases for repetition in range(1, payload.repetitions + 1) for label in ("A", "B")
    ])
    db.add(Job(workspace_id=user.workspace_id, experiment_id=experiment.id))
    db.add(Event(
        workspace_id=user.workspace_id,
        experiment_id=experiment.id,
        kind="experiment_created",
        payload_json={"case_count": len(cases), "repetitions": payload.repetitions},
    ))
    db.commit()
    return experiment_public(db, experiment)


@app.get("/api/v1/experiments/{experiment_id}")
def get_experiment(experiment_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return experiment_public(db, scoped(db, Experiment, experiment_id, user.workspace_id))


@app.post("/api/v1/experiments/{experiment_id}/cancel")
def cancel_experiment(experiment_id: str, user: User = Depends(require_write), db: Session = Depends(get_db)):
    experiment = scoped(db, Experiment, experiment_id, user.workspace_id)
    if experiment.status in ("completed", "cancelled"):
        raise HTTPException(status_code=409, detail="Experiment is already terminal")
    experiment.status = "cancelled"
    for run in db.scalars(select(CaseRun).where(CaseRun.experiment_id == experiment.id, CaseRun.status == "pending")).all():
        run.status = "cancelled"
    job = db.scalar(select(Job).where(Job.experiment_id == experiment.id))
    if job and job.status != "running":
        job.status = "cancelled"
    db.add(Event(workspace_id=user.workspace_id, experiment_id=experiment.id, kind="experiment_cancelled", payload_json={}))
    db.commit()
    return experiment_public(db, experiment)


@app.post("/api/v1/experiments/{experiment_id}/pause")
def pause_experiment(experiment_id: str, user: User = Depends(require_write), db: Session = Depends(get_db)):
    experiment = scoped(db, Experiment, experiment_id, user.workspace_id)
    if experiment.status not in ("queued", "running"):
        raise HTTPException(status_code=409, detail="Experiment cannot be paused in this state")
    experiment.status = "paused"
    job = db.scalar(select(Job).where(Job.experiment_id == experiment.id))
    if job and job.status == "queued":
        job.status = "paused"
    db.add(Event(workspace_id=user.workspace_id, experiment_id=experiment.id, kind="experiment_paused", payload_json={}))
    db.commit()
    return experiment_public(db, experiment)


@app.post("/api/v1/experiments/{experiment_id}/resume")
def resume_experiment(experiment_id: str, user: User = Depends(require_write), db: Session = Depends(get_db)):
    experiment = scoped(db, Experiment, experiment_id, user.workspace_id)
    if experiment.status != "paused":
        raise HTTPException(status_code=409, detail="Only paused experiments can resume")
    experiment.status = "queued"
    job = db.scalar(select(Job).where(Job.experiment_id == experiment.id))
    if job:
        job.status = "queued"
        job.lease_owner = None
        job.lease_until = None
    db.add(Event(workspace_id=user.workspace_id, experiment_id=experiment.id, kind="experiment_resumed", payload_json={}))
    db.commit()
    return experiment_public(db, experiment)


@app.get("/api/v1/experiments/{experiment_id}/results")
def list_results(experiment_id: str, status: str | None = None, task_type: str | None = None,
                 candidate_label: str | None = None, limit: int = Query(500, ge=1, le=1000), offset: int = Query(0, ge=0),
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    experiment = scoped(db, Experiment, experiment_id, user.workspace_id)
    query = select(CaseRun).where(CaseRun.experiment_id == experiment.id)
    if status:
        query = query.where(CaseRun.status == status)
    if candidate_label:
        query = query.where(CaseRun.candidate_label == candidate_label)
    runs = db.scalars(query.order_by(CaseRun.id)).all()
    cases = {c.id: c for c in db.scalars(select(Case).where(Case.dataset_version_id == experiment.dataset_version_id))}
    if task_type:
        runs = [r for r in runs if cases[r.case_id].task_type == task_type]
    return {"items": [result_public(db, run, cases[run.case_id]) for run in runs[offset:offset + limit]], "total": len(runs)}


@app.get("/api/v1/experiments/{experiment_id}/comparison")
def get_comparison(experiment_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    experiment = scoped(db, Experiment, experiment_id, user.workspace_id)
    return compare(db, experiment)


@app.get("/api/v1/experiments/{experiment_id}/events/history")
def event_history(experiment_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    experiment = scoped(db, Experiment, experiment_id, user.workspace_id)
    rows = db.scalars(select(Event).where(Event.experiment_id == experiment.id).order_by(Event.created_at)).all()
    return {"items": [{"id": e.id, "kind": e.kind, "payload": e.payload_json, "created_at": e.created_at} for e in rows]}


@app.get("/api/v1/experiments/{experiment_id}/events")
async def stream_events(experiment_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    scoped(db, Experiment, experiment_id, user.workspace_id)
    workspace_id = user.workspace_id
    last_id = request.headers.get("last-event-id")

    async def generate():
        seen: set[str] = set()
        replay = not bool(last_id)
        while not await request.is_disconnected():
            with SessionLocal() as session:
                rows = session.scalars(select(Event).where(Event.experiment_id == experiment_id, Event.workspace_id == workspace_id).order_by(Event.created_at, Event.id)).all()
                if not replay and last_id:
                    index = next((i for i, event in enumerate(rows) if event.id == last_id), -1)
                    seen.update(event.id for event in rows[:index + 1])
                    replay = True
                for event in rows:
                    if event.id in seen:
                        continue
                    seen.add(event.id)
                    payload = {"id": event.id, "kind": event.kind, "payload": event.payload_json, "created_at": event.created_at.isoformat()}
                    yield f"id: {event.id}\ndata: {json.dumps(payload)}\n\n"
            yield ": heartbeat\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/v1/reviews")
def list_reviews(experiment_id: str | None = None, status: str | None = None,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = select(ReviewAssignment).where(ReviewAssignment.workspace_id == user.workspace_id)
    if experiment_id:
        scoped(db, Experiment, experiment_id, user.workspace_id)
        query = query.where(ReviewAssignment.experiment_id == experiment_id)
    if status:
        query = query.where(ReviewAssignment.status == status)
    rows = db.scalars(query.order_by(ReviewAssignment.created_at)).all()
    return {"items": [review_public(db, row, user) for row in rows]}


@app.post("/api/v1/reviews/{review_id}/decision")
def submit_review(review_id: str, payload: ReviewInput, user: User = Depends(require_review), db: Session = Depends(get_db)):
    assignment = scoped(db, ReviewAssignment, review_id, user.workspace_id)
    if assignment.status == "adjudicated":
        raise HTTPException(status_code=409, detail="Review already adjudicated")
    existing = db.scalar(select(ReviewDecision).where(ReviewDecision.assignment_id == assignment.id, ReviewDecision.reviewer_id == user.id))
    if existing:
        raise HTTPException(status_code=409, detail="Reviewer already submitted a decision")
    db.add(ReviewDecision(assignment_id=assignment.id, reviewer_id=user.id, label=payload.label, score=payload.score, notes=payload.notes))
    db.flush()
    decisions = db.scalars(select(ReviewDecision).where(ReviewDecision.assignment_id == assignment.id)).all()
    assignment.status = "disagreement" if len({d.label for d in decisions}) > 1 else "reviewed"
    db.flush()
    experiment = db.get(Experiment, assignment.experiment_id)
    if experiment:
        unresolved = db.scalar(select(ReviewAssignment.id).where(
            ReviewAssignment.experiment_id == experiment.id,
            ReviewAssignment.status.in_(["pending", "disagreement"]),
        ))
        job = db.scalar(select(Job).where(Job.experiment_id == experiment.id))
        if job:
            experiment.status = "review_pending"
            if not unresolved and job.status == "waiting_review":
                job.status = "review_ready"
        db.add(Event(workspace_id=user.workspace_id, experiment_id=experiment.id, kind="review_decision", payload_json={"assignment_id": assignment.id, "reviewer_id": user.id}))
    db.commit()
    return review_public(db, assignment, user)


@app.post("/api/v1/reviews/{review_id}/adjudicate")
def adjudicate_review(review_id: str, payload: ReviewInput, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    assignment = scoped(db, ReviewAssignment, review_id, user.workspace_id)
    if assignment.status not in ("reviewed", "disagreement"):
        raise HTTPException(status_code=409, detail="Review requires at least one decision")
    assignment.adjudication_json = {"label": payload.label, "score": payload.score, "notes": payload.notes, "reviewer_id": user.id, "created_at": now().isoformat()}
    assignment.status = "adjudicated"
    db.flush()
    experiment = db.get(Experiment, assignment.experiment_id)
    if experiment:
        unresolved = db.scalar(select(ReviewAssignment.id).where(
            ReviewAssignment.experiment_id == experiment.id,
            ReviewAssignment.status.in_(["pending", "disagreement"]),
        ))
        job = db.scalar(select(Job).where(Job.experiment_id == experiment.id))
        if job:
            experiment.status = "review_pending"
            if not unresolved and job.status == "waiting_review":
                job.status = "review_ready"
    db.add(Event(workspace_id=user.workspace_id, experiment_id=assignment.experiment_id, kind="review_adjudicated", payload_json={"assignment_id": assignment.id}))
    db.commit()
    return review_public(db, assignment, user, include_identity=True)


@app.get("/api/v1/experiments/{experiment_id}/report")
def get_report(experiment_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    experiment = scoped(db, Experiment, experiment_id, user.workspace_id)
    return report(db, experiment)


@app.get("/api/v1/experiments/{experiment_id}/report/export")
def export_report(experiment_id: str, format: str = "json", user: User = Depends(current_user), db: Session = Depends(get_db)):
    experiment = scoped(db, Experiment, experiment_id, user.workspace_id)
    content = jsonable_encoder(report(db, experiment))
    if format == "json":
        body = json.dumps(content, indent=2, ensure_ascii=False)
        media = "application/json"
        extension = "json"
    elif format == "markdown":
        body = render_report_markdown(content)
        media = "text/markdown"
        extension = "md"
    else:
        raise HTTPException(status_code=422, detail="format must be json or markdown")
    return PlainTextResponse(body, media_type=media, headers={"Content-Disposition": f'attachment; filename="evalboard-report-{experiment.id}.{extension}"'})
