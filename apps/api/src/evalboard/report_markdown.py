"""Human-readable projection of the versioned JSON release report."""

import html
import json
from typing import Any


def _cell(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        value = f"{value:.6g}"
    return html.escape(str(value)).replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _interval(value: list[float] | None) -> str:
    return f"[{_cell(value[0])}, {_cell(value[1])}]" if value else "not justified"


def render_report_markdown(content: dict[str, Any]) -> str:
    comparison = content["comparison"]
    gate = content["gate"]
    provenance = content.get("provenance", {})
    reviews = content.get("review_summary", {})
    primary = comparison.get("primary", {}).get("by_task", {})
    counts = comparison.get("counts", {})
    lines = [
        f"# EvalBoard release report: {_cell(content['name'])}",
        "",
        f"Decision: **{_cell(content['decision']).upper()}**",
        f"Source: `{_cell(content['source'])}`",
        f"Paired cases: {comparison['paired_count']} / {comparison['denominator']}",
        f"Missing pairs: {comparison['missing_pairs']}",
        f"Regressions: {len(comparison['regressions'])}; improvements: {len(comparison['improvements'])}",
        "",
        "## Execution",
        "",
        f"Case runs: {counts.get('completed_runs', 0)} completed; {counts.get('failed_runs', 0)} failed or uncertain; {counts.get('cancelled_runs', 0)} cancelled.",
        f"Uncertain or budget-limited runs: {_cell(content.get('uncertain_or_budget_runs'))}",
        "",
        "## Provenance",
        "",
        f"- Dataset version: `{_cell(provenance.get('dataset_version_id'))}`",
        f"- Dataset content hash: `{_cell(provenance.get('dataset_content_hash'))}`",
        f"- Split: `{_cell(provenance.get('split'))}`; repetitions: {_cell(provenance.get('repetitions'))}",
        f"- Selected case IDs: {len(provenance.get('selected_case_ids', []))}",
        f"- Evaluator version: `{_cell(provenance.get('evaluator_version'))}`",
        "",
        "## Gate",
        "",
        f"Gate: {_cell(gate.get('name'))}",
        "",
        "```json",
        json.dumps(gate.get("thresholds", {}), indent=2, sort_keys=True),
        "```",
        "",
        "Failed conditions:",
        *(f"- {_cell(failure)}" for failure in gate.get("failures", [])),
        *([] if gate.get("failures") else ["- None"]),
        "",
        "## Task-specific primary correctness",
        "",
        "| Task | A successes | B successes | Paired / planned | B − A | 95% paired interval |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for task, row in primary.items():
        planned = row.get("planned_count")
        lines.append(
            f"| {_cell(task)} | {_cell(row.get('a_success_count'))}/{_cell(planned)} "
            f"| {_cell(row.get('b_success_count'))}/{_cell(planned)} "
            f"| {_cell(row.get('count'))}/{_cell(planned)} | {_cell(row.get('mean_delta'))} "
            f"| {_interval(row.get('confidence_interval'))} |"
        )
    lines.extend([
        "",
        "## Applicable metrics",
        "",
        "| Metric | Unit | Direction | A mean (n) | B mean (n) | B − A | Paired n | 95% paired interval |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ])
    for metric in comparison.get("metrics", []):
        a, b = metric["a"], metric["b"]
        lines.append(
            f"| {_cell(metric.get('label'))} | {_cell(metric.get('unit'))} | {_cell(metric.get('direction'))} "
            f"| {_cell(a.get('mean'))} ({_cell(a.get('count'))}) "
            f"| {_cell(b.get('mean'))} ({_cell(b.get('count'))}) | {_cell(metric.get('delta'))} "
            f"| {_cell(metric.get('paired_count'))} | {_interval(metric.get('confidence_interval'))} |"
        )
    regressions = comparison.get("regressions", [])
    lines.extend(["", "## Regression examples", ""])
    if regressions:
        lines.extend([
            "| Case | Task | Primary metric | A score | B score |",
            "| --- | --- | --- | ---: | ---: |",
        ])
        for item in regressions[:20]:
            lines.append(
                f"| {_cell(item.get('case_key'))} | {_cell(item.get('task_type'))} "
                f"| {_cell(item.get('metric_key'))} | {_cell(item.get('a', {}).get('score'))} "
                f"| {_cell(item.get('b', {}).get('score'))} |"
            )
        if len(regressions) > 20:
            lines.append(f"\n{len(regressions) - 20} additional examples are in the JSON export.")
    else:
        lines.append("No task-primary regressions recorded.")
    lines.extend([
        "",
        "## Human review",
        "",
        f"Assignments: {_cell(reviews.get('assignments'))}; decisions: {_cell(reviews.get('decisions'))}; pending: {_cell(content.get('pending_reviews'))}",
        "",
        "Status counts:",
        *(f"- {_cell(key)}: {_cell(value)}" for key, value in reviews.get("by_status", {}).items()),
        "",
        "Decision labels:",
        *(f"- {_cell(key)}: {_cell(value)}" for key, value in reviews.get("by_label", {}).items()),
        "",
        "## Limitations",
        "",
        *(f"- {_cell(item)}" for item in content.get("limitations", [])),
        "",
    ])
    return "\n".join(lines)
