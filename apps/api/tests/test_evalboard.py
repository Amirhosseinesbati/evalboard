import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from evalboard.analysis import _paired_interval
from evalboard.dataset import generate_cases, parse_jsonl
from evalboard.db import SessionLocal
from evalboard.evaluators import evaluate, primary_metric
from evalboard.models import (
    CandidateConfig,
    Case,
    CaseRun,
    Job,
    ReviewAssignment,
    Score,
    TargetAdapterRecord,
    now,
)
from evalboard.targets import (
    HttpTarget,
    PermanentTargetError,
    RecordedTarget,
    _known_cost,
    valid_token_count,
    validate_http_endpoint,
)
from evalboard.worker import build_experiment_graph, checkpoint_saver, run_once


def test_dataset_generator_and_parser():
    cases = generate_cases()
    assert len(cases) == 240
    assert sum(case["split"] == "development" for case in cases) == 80
    assert sum(case["split"] == "held_out" for case in cases) == 160
    assert len({case["case_key"] for case in cases}) == 240
    parsed, errors = parse_jsonl(json.dumps(cases[0]) + "\n" + "{invalid\n")
    assert len(parsed) == 1
    assert errors[0]["row"] == 2


def test_missing_field_extraction_requires_abstention():
    payload = next(case for case in generate_cases() if "missing_field" in case["tags"])
    case = Case(task_type=payload["task_type"], expected_json=payload["expected"], context_json=payload["context"])
    run = CaseRun(status="completed", output_json={"answer": {}, "abstained": False})
    scores = {row["metric_key"]: row["value"] for row in evaluate(case, run)}
    assert scores["exact_match"] == 1
    assert scores["structured_valid"] == 1
    assert scores["structured_task_correct"] == 0
    assert primary_metric("structured_extraction") == "structured_task_correct"


def test_known_answer_bootstrap_and_cost_arithmetic():
    assert _paired_interval([1.0] * 30) == [1.0, 1.0]
    config = CandidateConfig(options_json={"prices_per_million_tokens": {"input": 2.0, "output": 10.0}})
    assert _known_cost(config, 123, 45) == pytest.approx(0.000696)
    with pytest.raises(PermanentTargetError):
        valid_token_count(-1)
    with pytest.raises(PermanentTargetError):
        RecordedTarget(TargetAdapterRecord(recorded_outputs_json={"x": {"output": {}, "cost_usd": -0.01}})).run(
            "x", {}, {}, config,
        )


def test_http_url_rejects_query_credentials(monkeypatch):
    monkeypatch.setattr("evalboard.targets.get_settings", lambda: SimpleNamespace(allowed_http_origins={"https://api.example.com"}))
    with pytest.raises(ValueError, match="query parameters"):
        validate_http_endpoint("https://api.example.com/infer?token=secret")


def test_http_target_rejects_response_without_contract_version(monkeypatch):
    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"output": {"answer": "ok"}}

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr("evalboard.targets.validate_http_endpoint", lambda _endpoint: None)
    monkeypatch.setattr("evalboard.targets.httpx.Client", lambda **_kwargs: FakeClient())
    target = TargetAdapterRecord(endpoint="https://api.example.com/infer", kind="http")
    config = CandidateConfig(model_id="fixture", options_json={})
    with pytest.raises(PermanentTargetError, match="response version must be 1.0"):
        HttpTarget(target).run("case-1", {"question": "q"}, {}, config)


def test_auth_workspace_boundaries(client, admin):
    assert client.get("/api/v1/datasets").status_code == 401
    datasets = admin.get("/api/v1/datasets").json()["items"]
    assert len(datasets) == 1
    other = client.post("/api/v1/auth/login", json={
        "username": "admin@harbor.example.com",
        "password": "Demo123!",
    })
    assert other.status_code == 200
    assert client.get("/api/v1/datasets").json()["items"] == []
    assert client.get(f"/api/v1/datasets/{datasets[0]['id']}").status_code == 404
    assert client.get("/api/v1/experiments").json()["items"] == []


def test_secret_references_and_blind_reviewer(client, admin):
    operator = client.post("/api/v1/auth/login", json={
        "username": "operator@northstar.example.com", "password": "Demo123!",
    })
    assert operator.status_code == 200
    assert client.post("/api/v1/targets", json={"name": "Invalid", "kind": "bundled"}).status_code == 403
    forbidden = admin.post("/api/v1/targets", json={
        "name": "Invalid", "kind": "bundled", "secret_ref": "POSTGRES_PASSWORD",
    })
    assert forbidden.status_code == 422
    accepted = admin.post("/api/v1/targets", json={
        "name": "Scoped secret fixture", "kind": "bundled", "secret_ref": "EVALBOARD_TARGET_SAMPLE",
    })
    assert accepted.status_code == 201
    assert accepted.json()["has_secret_ref"] is True
    assert "secret_ref" not in accepted.json()
    bad_recorded = admin.post("/api/v1/targets", json={
        "name": "Bad recorded import", "kind": "recorded",
        "recorded_outputs": {"CASE-1": {"output": {"answer": "x"}, "cost_usd": -0.1}},
    })
    assert bad_recorded.status_code == 422
    leak = client.post("/api/v1/configs", json={
        "name": "Leak", "target_id": accepted.json()["id"], "model_id": "fixture",
        "options": {"api_key": "must-not-persist"},
    })
    assert leak.status_code == 422

    reviewer = client.post("/api/v1/auth/login", json={
        "username": "reviewer@northstar.example.com", "password": "Demo123!",
    })
    assert reviewer.status_code == 200
    assert client.get("/api/v1/datasets").status_code == 403
    assert client.get("/api/v1/configs").status_code == 403
    assert client.get("/api/v1/experiments").status_code == 403
    reviews = client.get("/api/v1/reviews").json()["items"]
    assert reviews
    assert reviews[0]["side_map_hidden"] is True
    assert reviews[0]["decisions"] == []


def test_blind_review_side_swap_preserves_shared_evidence(client, admin):
    dataset = admin.get("/api/v1/datasets").json()["items"][0]
    configs = {item["name"]: item for item in admin.get("/api/v1/configs").json()["items"]}
    created = admin.post("/api/v1/experiments", json={
        "name": "Blind side swap fixture",
        "dataset_version_id": dataset["latest_version_id"],
        "candidate_a_id": configs["Fast · legacy return policy"]["id"],
        "candidate_b_id": configs["Fast · corrected return policy"]["id"],
        "split": "development", "max_cases": 2,
    })
    assert created.status_code == 201
    assert run_once()
    login = client.post("/api/v1/auth/login", json={
        "username": "reviewer@northstar.example.com", "password": "Demo123!",
    })
    assert login.status_code == 200
    before = next(item for item in client.get(f"/api/v1/reviews?experiment_id={created.json()['id']}").json()["items"] if item["output_left"] != item["output_right"])
    assert before["side_map_hidden"] is True
    assert "side_map" not in before
    assert "candidate_a_id" not in before and "candidate_b_id" not in before
    with SessionLocal.begin() as db:
        assignment = db.get(ReviewAssignment, before["id"])
        assignment.side_map_json = {"left": assignment.side_map_json["right"], "right": assignment.side_map_json["left"]}
    after = next(item for item in client.get(f"/api/v1/reviews?experiment_id={created.json()['id']}").json()["items"] if item["id"] == before["id"])
    for key in ("case_key", "task_type", "prompt", "evidence"):
        assert after[key] == before[key]
    assert after["output_left"] == before["output_right"]
    assert after["output_right"] == before["output_left"]
    assert "side_map" not in after
    assert "candidate_a_id" not in after and "candidate_b_id" not in after


def test_import_immutable_edit_and_validation(admin):
    case = generate_cases()[0]
    invalid = admin.post("/api/v1/datasets/import", json={"name": "Bad", "jsonl": json.dumps(case) + "\n{invalid"})
    assert invalid.status_code == 422
    assert invalid.json()["detail"]["errors"][0]["row"] == 2
    created = admin.post("/api/v1/datasets/import", json={"name": "Tiny", "jsonl": json.dumps(case)})
    assert created.status_code == 201
    payload = created.json()
    dataset_id = payload["dataset"]["id"]
    version_id = payload["version"]["id"]
    original = admin.get(f"/api/v1/datasets/{dataset_id}/versions/{version_id}/cases").json()["items"][0]
    edited_case = {key: value for key, value in original.items() if key != "id"}
    edited_case["expected"]["answer"] = "31 days"
    edited = admin.post(
        f"/api/v1/datasets/{dataset_id}/versions/{version_id}/cases/{original['id']}/edit",
        json={"case": edited_case},
    )
    assert edited.status_code == 201
    new_id = edited.json()["version"]["id"]
    assert new_id != version_id
    old = admin.get(f"/api/v1/datasets/{dataset_id}/versions/{version_id}/cases").json()["items"][0]
    new = admin.get(f"/api/v1/datasets/{dataset_id}/versions/{new_id}/cases").json()["items"][0]
    assert old["expected"]["answer"] == "30 days"
    assert new["expected"]["answer"] == "31 days"


def test_seeded_regression_and_improvement_gate(admin):
    experiments = admin.get("/api/v1/experiments").json()["items"]
    by_name = {item["name"]: item for item in experiments}
    regression = admin.get(f"/api/v1/experiments/{by_name['Cheaper faster, return regression']['id']}/report").json()
    repaired = admin.get(f"/api/v1/experiments/{by_name['Return policy repaired']['id']}/report").json()
    assert regression["decision"] == "fail"
    assert len(regression["comparison"]["regressions"]) > 0
    assert regression["comparison"]["denominator"] == 40
    assert repaired["decision"] == "pass"
    assert repaired["comparison"]["denominator"] == 40
    grounded = repaired["comparison"]["primary"]["by_task"]["grounded_qa"]
    assert grounded["a_success_count"] == 7
    assert grounded["b_success_count"] == 8
    assert grounded["count"] == grounded["planned_count"] == 8


def test_experiment_to_review_to_report(admin):
    dataset = next(item for item in admin.get("/api/v1/datasets").json()["items"] if item["name"] == "Aster Supply support benchmark")
    configs = admin.get("/api/v1/configs").json()["items"]
    by_name = {item["name"]: item for item in configs}
    created = admin.post("/api/v1/experiments", json={
        "name": "Paired fixture smoke",
        "dataset_version_id": dataset["latest_version_id"],
        "candidate_a_id": by_name["Baseline · accurate"]["id"],
        "candidate_b_id": by_name["Fast · corrected return policy"]["id"],
        "split": "development",
        "max_cases": 4,
        "repetitions": 1,
    })
    assert created.status_code == 201, created.text
    experiment_id = created.json()["id"]
    assert created.json()["source"] == "bundled_fixture"
    assert run_once()
    detail = admin.get(f"/api/v1/experiments/{experiment_id}").json()
    assert detail["status"] == "review_pending"
    assert detail["total_runs"] == 8
    assert detail["completed_runs"] == 8
    comparison = admin.get(f"/api/v1/experiments/{experiment_id}/comparison").json()
    assert comparison["paired_count"] == 4
    assert comparison["denominator"] == 4
    assert comparison["missing_pairs"] == 0
    reviews = admin.get(f"/api/v1/reviews?experiment_id={experiment_id}").json()["items"]
    assert len(reviews) == 4
    assert all("side_map" not in item for item in reviews)
    with SessionLocal() as db:
        job = db.scalar(select(Job).where(Job.experiment_id == experiment_id))
        assert job.status == "waiting_review"
    with checkpoint_saver() as saver:
        graph = build_experiment_graph(saver)
        snapshot = graph.get_state({"configurable": {"thread_id": f"experiment:{experiment_id}"}})
        assert any(task.interrupts for task in snapshot.tasks)
    for review in reviews:
        decision = admin.post(f"/api/v1/reviews/{review['id']}/decision", json={"label": "tie", "score": 4, "notes": "Both grounded"})
        assert decision.status_code == 200
    with SessionLocal() as db:
        job = db.scalar(select(Job).where(Job.experiment_id == experiment_id))
        assert job.status == "review_ready"
    assert run_once()
    assert admin.get(f"/api/v1/experiments/{experiment_id}").json()["status"] == "completed"
    with checkpoint_saver() as saver:
        graph = build_experiment_graph(saver)
        snapshot = graph.get_state({"configurable": {"thread_id": f"experiment:{experiment_id}"}})
        assert not snapshot.next
    report = admin.get(f"/api/v1/experiments/{experiment_id}/report").json()
    assert report["decision"] == "pass"
    assert report["provenance"]["dataset_content_hash"]
    assert len(report["provenance"]["selected_case_ids"]) == 4
    assert report["review_summary"]["decisions"] == 4
    exported = admin.get(f"/api/v1/experiments/{experiment_id}/report/export?format=json")
    assert exported.status_code == 200
    assert "attachment" in exported.headers["content-disposition"]
    with SessionLocal() as db:
        runs = db.scalars(select(CaseRun).where(CaseRun.experiment_id == experiment_id)).all()
        scores = db.scalars(select(Score).where(Score.case_run_id.in_([r.id for r in runs]))).all()
        assert len({(s.case_run_id, s.metric_key) for s in scores}) == len(scores)


def test_cancellation_persists(admin):
    dataset = next(item for item in admin.get("/api/v1/datasets").json()["items"] if item["name"] == "Aster Supply support benchmark")
    configs = admin.get("/api/v1/configs").json()["items"]
    created = admin.post("/api/v1/experiments", json={
        "name": "Cancelled fixture",
        "dataset_version_id": dataset["latest_version_id"],
        "candidate_a_id": configs[0]["id"],
        "candidate_b_id": configs[1]["id"],
        "max_cases": 2,
    })
    assert created.status_code == 201
    experiment_id = created.json()["id"]
    cancelled = admin.post(f"/api/v1/experiments/{experiment_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["cancelled_runs"] == 4
    assert admin.get(f"/api/v1/experiments/{experiment_id}/report").json()["decision"] == "incomplete"


def test_expired_lease_marks_uncertain_without_duplicate_scores(admin):
    dataset = next(item for item in admin.get("/api/v1/datasets").json()["items"] if item["name"] == "Aster Supply support benchmark")
    configs = admin.get("/api/v1/configs").json()["items"]
    created = admin.post("/api/v1/experiments", json={
        "name": "Recovery fixture",
        "dataset_version_id": dataset["latest_version_id"],
        "candidate_a_id": configs[0]["id"],
        "candidate_b_id": configs[1]["id"],
        "max_cases": 1,
    })
    assert created.status_code == 201
    experiment_id = created.json()["id"]
    with SessionLocal.begin() as db:
        job = db.query(Job).filter(Job.experiment_id == experiment_id).one()
        job.status = "running"
        job.lease_owner = "dead-worker"
        job.lease_until = now() - timedelta(seconds=60)
        run = db.query(CaseRun).filter(CaseRun.experiment_id == experiment_id).first()
        run.status = "running"
        uncertain_id = run.id
    assert run_once()
    with SessionLocal() as db:
        uncertain = db.get(CaseRun, uncertain_id)
        assert uncertain.status == "uncertain"
        assert uncertain.error_category == "uncertain_inference"
        assert uncertain.output_json is None
        scores = db.scalars(select(Score).where(Score.case_run_id == uncertain.id)).all()
        assert len({score.metric_key for score in scores}) == len(scores)
    comparison = admin.get(f"/api/v1/experiments/{experiment_id}/comparison").json()
    assert comparison["denominator"] == 1
    assert comparison["paired_count"] == 1
    report = admin.get(f"/api/v1/experiments/{experiment_id}/report").json()
    assert report["decision"] == "incomplete"
    assert report["uncertain_or_budget_runs"] == 1


def test_budget_reservation_blocks_unaffordable_case(admin):
    dataset = next(item for item in admin.get("/api/v1/datasets").json()["items"] if item["name"] == "Aster Supply support benchmark")
    cases = admin.get(f"/api/v1/datasets/{dataset['id']}/versions/{dataset['latest_version_id']}/cases?split=development").json()["items"]
    case_key = cases[0]["case_key"]
    target = admin.post("/api/v1/targets", json={
        "name": "Expensive recorded fixture", "kind": "recorded",
        "recorded_outputs": {case_key: {"output": {"answer": "30 days"}, "cost_usd": 0.02}},
    })
    assert target.status_code == 201
    target_id = target.json()["id"]
    configs = [admin.post("/api/v1/configs", json={
        "name": f"Cost fixture {label}", "target_id": target_id, "model_id": "recorded:v1",
        "prompt": "Fixture", "concurrency": 1,
    }).json() for label in ("A", "B")]
    created = admin.post("/api/v1/experiments", json={
        "name": "Budget fixture",
        "dataset_version_id": dataset["latest_version_id"],
        "candidate_a_id": configs[0]["id"],
        "candidate_b_id": configs[1]["id"],
        "split": "development", "max_cases": 1, "budget_usd": 0.01,
    })
    assert created.status_code == 201
    experiment_id = created.json()["id"]
    assert run_once()
    results = admin.get(f"/api/v1/experiments/{experiment_id}/results").json()["items"]
    assert len(results) == 2
    assert all(result["error_category"] == "budget_exhausted" for result in results)
    assert all(result["cost_usd"] is None for result in results)


def test_candidate_budget_stops_only_its_side(admin):
    dataset = admin.get("/api/v1/datasets").json()["items"][0]
    case = admin.get(f"/api/v1/datasets/{dataset['id']}/versions/{dataset['latest_version_id']}/cases?split=development").json()["items"][0]
    target = admin.post("/api/v1/targets", json={
        "name": "Candidate cap fixture", "kind": "recorded",
        "recorded_outputs": {case["case_key"]: {"output": {"answer": "30 days"}, "cost_usd": 0.02}},
    }).json()
    a = admin.post("/api/v1/configs", json={
        "name": "Capped side", "target_id": target["id"], "model_id": "recorded:v1", "budget_usd": 0.01,
    }).json()
    b = admin.post("/api/v1/configs", json={
        "name": "Uncapped side", "target_id": target["id"], "model_id": "recorded:v1",
    }).json()
    created = admin.post("/api/v1/experiments", json={
        "name": "Candidate cap check", "dataset_version_id": dataset["latest_version_id"],
        "candidate_a_id": a["id"], "candidate_b_id": b["id"],
        "split": "development", "max_cases": 1,
    })
    assert created.status_code == 201, created.text
    assert created.json()["source"] == "recorded_import"
    assert run_once()
    results = admin.get(f"/api/v1/experiments/{created.json()['id']}/results").json()["items"]
    by_label = {item["candidate_label"]: item for item in results}
    assert by_label["A"]["error_category"] == "budget_exhausted"
    assert by_label["B"]["status"] == "completed"
    assert by_label["B"]["cost_usd"] == pytest.approx(0.02)
