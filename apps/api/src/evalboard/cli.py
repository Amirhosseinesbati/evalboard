"""Local operations and CI gate entrypoint."""

import argparse
import json
import sys

from evalboard.analysis import report
from evalboard.db import SessionLocal
from evalboard.models import Experiment
from evalboard.retention import parse_cutoff, redact_workspace
from evalboard.seed import seed_demo


def main() -> int:
    parser = argparse.ArgumentParser(prog="evalboard", description="EvalBoard local operations and release gate")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed", help="Idempotently seed the synthetic demo")
    sub.add_parser("worker-once", help="Process one queued experiment if available")
    gate = sub.add_parser("gate", help="Print a JSON release report and return a CI exit code")
    gate.add_argument("experiment_id")
    export = sub.add_parser("report", help="Print a versioned JSON report")
    export.add_argument("experiment_id")
    redact = sub.add_parser("redact", help="Preview or redact old terminal experiment content in one workspace")
    redact.add_argument("--workspace-id", required=True)
    redact.add_argument("--before", required=True, help="ISO-8601 timestamp with timezone, e.g. 2026-01-01T00:00:00Z")
    redact.add_argument("--apply", action="store_true", help="Apply the redaction; omitted means dry run")
    redact.add_argument("--confirm-workspace-id", help="Must exactly match --workspace-id when using --apply")
    args = parser.parse_args()
    if args.command == "seed":
        seed_demo()
        print("Synthetic demo dataset seeded idempotently.")
        return 0
    if args.command == "worker-once":
        from evalboard.worker import run_once

        print("processed" if run_once() else "no queued job")
        return 0
    if args.command == "redact":
        try:
            cutoff = parse_cutoff(args.before)
            with SessionLocal() as db:
                payload = redact_workspace(
                    db,
                    args.workspace_id,
                    cutoff,
                    apply=args.apply,
                    confirm_workspace_id=args.confirm_workspace_id,
                )
                if args.apply:
                    db.commit()
        except ValueError as exc:
            print(json.dumps({"error": str(exc)}), file=sys.stderr)
            return 2
        print(json.dumps(payload, indent=2, default=str))
        return 0
    with SessionLocal() as db:
        experiment = db.get(Experiment, args.experiment_id)
        if not experiment:
            print(json.dumps({"error": "experiment_not_found"}), file=sys.stderr)
            return 2
        payload = report(db, experiment)
    print(json.dumps(payload, indent=2, default=str))
    if args.command == "gate":
        return {"pass": 0, "fail": 1, "incomplete": 2}[payload["decision"]]
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
