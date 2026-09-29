from evalboard.report_markdown import render_report_markdown


def test_markdown_export_includes_release_evidence() -> None:
    report = {
        "name": "Candidate A/B",
        "decision": "fail",
        "source": "recorded_import",
        "gate": {"name": "No regression", "thresholds": {"max_regressions": 0}, "failures": ["regression count above threshold"]},
        "comparison": {
            "paired_count": 1,
            "denominator": 2,
            "missing_pairs": 1,
            "regressions": [{"case_key": "qa|1", "task_type": "grounded_qa", "metric_key": "exact_match", "a": {"score": 1}, "b": {"score": 0}}],
            "improvements": [],
            "primary": {"by_task": {"grounded_qa": {"a_success_count": 1, "b_success_count": 0, "count": 1, "planned_count": 2, "mean_delta": -1.0, "confidence_interval": None}}},
            "metrics": [{"label": "Exact answer match", "a": {"mean": 1.0, "count": 1}, "b": {"mean": 0.0, "count": 1}, "delta": -1.0, "paired_count": 1}],
        },
        "provenance": {"dataset_version_id": "version-1", "dataset_content_hash": "sha256-hash", "split": "held_out", "repetitions": 1, "selected_case_ids": ["case-1", "case-2"], "evaluator_version": "1.0.0"},
        "review_summary": {"assignments": 1, "decisions": 1, "by_status": {"reviewed": 1}, "by_label": {"left": 1}},
        "pending_reviews": 0,
        "limitations": ["Check source before interpreting quality."],
    }

    markdown = render_report_markdown(report)

    assert "Decision: **FAIL**" in markdown
    assert "Paired cases: 1 / 2" in markdown
    assert "Dataset content hash: `sha256-hash`" in markdown
    assert "regression count above threshold" in markdown
    assert "| grounded_qa | 1/2 | 0/2 | 1/2 | -1 | not justified |" in markdown
    assert "| qa\\|1 | grounded_qa | exact_match | 1 | 0 |" in markdown
    assert "Assignments: 1; decisions: 1; pending: 0" in markdown
    assert "Check source before interpreting quality." in markdown
