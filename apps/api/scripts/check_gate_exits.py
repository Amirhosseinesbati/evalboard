"""Verify the CLI gate exit codes against seeded and full-run fixtures."""

import json
import subprocess
import sys

from sqlalchemy import select

from evalboard.db import SessionLocal
from evalboard.models import Experiment

NAMES = (
    "Cheaper faster, return regression",
    "Return policy repaired",
    "Full 240-pair policy repair · synthetic",
)


def main() -> None:
    with SessionLocal() as db:
        experiments = {
            item.name: item.id
            for item in db.scalars(select(Experiment).where(Experiment.name.in_(NAMES)))
        }
    for name in NAMES:
        experiment_id = experiments[name]
        command = [sys.executable, "-m", "evalboard.cli", "gate", experiment_id]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        decision = json.loads(completed.stdout)["decision"]
        print(json.dumps({
            "name": name,
            "command": f"python -m evalboard.cli gate {experiment_id}",
            "decision": decision,
            "exit_code": completed.returncode,
        }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
