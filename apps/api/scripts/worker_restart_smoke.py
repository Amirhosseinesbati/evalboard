"""Create and inspect a slow bundled experiment for process recovery testing."""

import argparse
import json
import os

from evalboard.sdk import EvalBoardClient

NAME = "Worker process restart acceptance · synthetic"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["create", "inspect"])
    args = parser.parse_args()
    with EvalBoardClient(os.getenv("EVALBOARD_BASE_URL", "http://127.0.0.1:8010"), timeout=60) as client:
        client.login("admin@northstar.example.com", "Demo123!")
        existing = next((item for item in client._request("GET", "/experiments")["items"] if item["name"] == NAME), None)
        if args.phase == "create" and existing is None:
            dataset = next(item for item in client.list_datasets()["items"] if item["name"] == "Aster Supply support benchmark")
            target = next(item for item in client._request("GET", "/targets")["items"] if item["kind"] == "bundled")
            configs = client.list_configs()["items"]
            ids = []
            for label in ("A", "B"):
                name = f"Restart test slow {label}"
                config = next((item for item in configs if item["name"] == name), None)
                if config is None:
                    config = client._request("POST", "/configs", json={
                        "name": name,
                        "target_id": target["id"],
                        "model_id": "bundled:deterministic-v1",
                        "options": {"work_ms": 200},
                        "concurrency": 1,
                    })
                ids.append(config["id"])
            existing = client.create_experiment({
                "name": NAME,
                "dataset_version_id": dataset["latest_version_id"],
                "candidate_a_id": ids[0],
                "candidate_b_id": ids[1],
                "split": "development",
                "max_cases": 40,
            })
        if existing is None:
            raise SystemExit("Run create first")
        detail = client.experiment(existing["id"])
        report = client.report(existing["id"])
        results = client._request("GET", f"/experiments/{existing['id']}/results", params={"limit": 1000})["items"]
        events = client._request("GET", f"/experiments/{existing['id']}/events/history")["items"]
        print(json.dumps({
            "id": existing["id"],
            "status": detail["status"],
            "total": detail["total_runs"],
            "completed": detail["completed_runs"],
            "failed": detail["failed_runs"],
            "running": sum(item["status"] == "running" for item in results),
            "uncertain": sum(item["status"] == "uncertain" for item in results),
            "uncertain_ids": [item["id"] for item in results if item["status"] == "uncertain"],
            "duplicate_score_keys": sum(
                len(item["scores"]) - len({score["metric_key"] for score in item["scores"]}) for item in results
            ),
            "job_recovered_events": sum(item["kind"] == "job_recovered" for item in events),
            "report_decision": report["decision"],
        }), flush=True)


if __name__ == "__main__":
    main()
