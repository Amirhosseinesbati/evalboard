"""Print compact decision evidence for all six seeded historical scenarios."""

import json

from sqlalchemy import select

from evalboard.analysis import report
from evalboard.db import SessionLocal
from evalboard.models import Experiment


def main() -> None:
    with SessionLocal() as db:
        experiments = db.scalars(select(Experiment).where(Experiment.source == "simulated_history").order_by(Experiment.name)).all()
        for experiment in experiments:
            result = report(db, experiment)
            comparison = result["comparison"]
            print(json.dumps({
                "name": experiment.name,
                "planned_pairs": comparison["denominator"],
                "completed_runs": comparison["counts"]["completed_runs"],
                "failed_runs": comparison["counts"]["failed_runs"],
                "uncertain_runs": 0,
                "regressions": comparison["counts"]["regressions"],
                "improvements": comparison["counts"]["improvements"],
                "decision": result["decision"],
                "source": experiment.source,
            }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
