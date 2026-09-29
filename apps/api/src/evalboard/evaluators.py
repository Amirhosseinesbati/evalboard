"""Task-scoped metric plugins with explicit applicability and failure semantics."""

import json
import re
from dataclasses import dataclass
from typing import Any, Callable

from jsonschema import Draft202012Validator, FormatChecker

from evalboard.models import Case, CaseRun


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    unit: str
    direction: str
    tasks: frozenset[str]
    failure_value: float | None
    score: Callable[[Case, CaseRun], float | None]


def _normalized(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return re.sub(r"[^\w]+", " ", str(value).casefold()).strip()


def exact_match(case: Case, run: CaseRun) -> float:
    return float((run.output_json or {}).get("answer") == case.expected_json.get("answer"))


def normalized_match(case: Case, run: CaseRun) -> float:
    return float(_normalized((run.output_json or {}).get("answer")) == _normalized(case.expected_json.get("answer")))


def structured_valid(case: Case, run: CaseRun) -> float:
    answer = (run.output_json or {}).get("answer")
    if not isinstance(answer, dict):
        return 0.0
    schema = case.expected_json.get("schema", {})
    try:
        Draft202012Validator.check_schema(schema)
        Draft202012Validator(schema, format_checker=FormatChecker()).validate(answer)
        return 1.0
    except Exception:
        return 0.0


def action_correct(case: Case, run: CaseRun) -> float:
    output = run.output_json or {}
    return float(
        output.get("action") == case.expected_json.get("action")
        and output.get("arguments") == case.expected_json.get("arguments")
    )


def retrieval_recall(case: Case, run: CaseRun) -> float:
    expected = set(case.expected_json.get("evidence_ids", []))
    observed = set((run.output_json or {}).get("retrieved_ids", []))
    return len(expected & observed) / len(expected) if expected else 0.0


def citation_support(case: Case, run: CaseRun) -> float:
    documents = {d.get("id") for d in case.context_json.get("documents", [])}
    cited = set((run.output_json or {}).get("evidence_ids", []))
    return float(bool(cited) and cited <= documents and normalized_match(case, run) == 1.0)


def abstention_correct(case: Case, run: CaseRun) -> float:
    return float(bool((run.output_json or {}).get("abstained")) == bool(case.expected_json.get("abstain")))


def structured_task_correct(case: Case, run: CaseRun) -> float:
    return exact_match(case, run) * abstention_correct(case, run)


ALL_TASKS = frozenset({"grounded_qa", "tool_use", "structured_extraction", "abstention", "adversarial"})
QA_TASKS = frozenset({"grounded_qa", "adversarial"})

METRICS = (
    Metric("exact_match", "Exact answer match", "fraction", "higher", ALL_TASKS - {"abstention"}, 0.0, exact_match),
    Metric("normalized_match", "Normalized answer match", "fraction", "higher", QA_TASKS, 0.0, normalized_match),
    Metric("structured_valid", "Structured output valid", "fraction", "higher", frozenset({"structured_extraction"}), 0.0, structured_valid),
    Metric("structured_task_correct", "Extraction and abstention correct", "fraction", "higher", frozenset({"structured_extraction"}), 0.0, structured_task_correct),
    Metric("action_correct", "Expected action and arguments", "fraction", "higher", frozenset({"tool_use"}), 0.0, action_correct),
    Metric("retrieval_recall", "Expected evidence recall", "fraction", "higher", QA_TASKS, 0.0, retrieval_recall),
    Metric("citation_support", "Reference-consistent citation", "fraction", "higher", QA_TASKS, 0.0, citation_support),
    Metric("abstention_correct", "Correct abstention", "fraction", "higher", frozenset({"abstention", "structured_extraction"}), 0.0, abstention_correct),
    Metric("latency_ms", "Inference latency", "ms", "lower", ALL_TASKS, None, lambda _c, r: r.latency_ms),
    Metric("token_cost_usd", "Known token cost", "USD", "lower", ALL_TASKS, None, lambda _c, r: r.cost_usd),
)
METRIC_BY_KEY = {m.key: m for m in METRICS}


def evaluate(case: Case, run: CaseRun) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for metric in METRICS:
        if case.task_type not in metric.tasks:
            continue
        if run.status != "completed" and metric.failure_value is not None:
            value = metric.failure_value
        elif run.status != "completed" and metric.key not in {"latency_ms", "token_cost_usd"}:
            value = None
        else:
            value = metric.score(case, run)
        result.append({
            "metric_key": metric.key,
            "value": value,
            "applicable": value is not None,
            "unit": metric.unit,
            "direction": metric.direction,
            "detail": {"failure_policy": "zero" if metric.failure_value == 0 else "missing"},
        })
    return result


def primary_metric(task_type: str) -> str:
    return {
        "grounded_qa": "normalized_match",
        "adversarial": "normalized_match",
        "tool_use": "action_correct",
        "structured_extraction": "structured_task_correct",
        "abstention": "abstention_correct",
    }[task_type]
