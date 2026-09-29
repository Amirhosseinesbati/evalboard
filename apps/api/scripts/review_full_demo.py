"""Inspect and submit the six blinded reviews for the full synthetic run."""

import argparse
import json
import os

from evalboard.sdk import EvalBoardClient


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("experiment_id", help="Experiment ID printed by full_demo_run.py")
    parser.add_argument("--submit", action="store_true", help="Submit evidence-based decisions")
    args = parser.parse_args()
    with EvalBoardClient(os.getenv("EVALBOARD_BASE_URL", "http://127.0.0.1:8010")) as client:
        client.login("reviewer@northstar.example.com", "Demo123!")
        reviews = client._request("GET", "/reviews", params={"experiment_id": args.experiment_id})["items"]
        for review in reviews:
            print(json.dumps({
                "id": review["id"],
                "case_key": review["case_key"],
                "task_type": review["task_type"],
                "prompt": review["prompt"],
                "evidence": review["evidence"],
                "output_left": review["output_left"],
                "output_right": review["output_right"],
                "status": review["status"],
                "decisions": review["decisions"],
            }, ensure_ascii=False), flush=True)
        if args.submit:
            for review in reviews:
                if review["decisions"]:
                    continue
                # The visible KB says 30 days for standard returns. Other
                # sampled outputs are identical, so they receive a tie.
                if review["output_left"] == review["output_right"]:
                    label = "tie"
                elif review["case_key"] == "AST-01-001":
                    label = "left" if review["output_left"].get("answer") == "30 days" else "right"
                else:
                    raise ValueError(f"Review {review['case_key']} needs a human decision")
                client._request("POST", f"/reviews/{review['id']}/decision", json={
                    "label": label,
                    "score": 5,
                    "notes": "Judged against the displayed synthetic evidence.",
                })
                print(f"submitted={review['case_key']}:{label}", flush=True)


if __name__ == "__main__":
    main()
