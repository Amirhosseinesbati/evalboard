import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect


def test_frozen_migration_upgrade_and_downgrade(tmp_path: Path):
    db_path = tmp_path / "migration.db"
    url = f"sqlite:///{db_path.as_posix()}"
    environment = os.environ.copy()
    environment["DATABASE_URL"] = url
    project_dir = Path(__file__).resolve().parents[1]
    upgrade = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=project_dir,
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert upgrade.returncode == 0, upgrade.stderr
    engine = create_engine(url)
    tables = set(inspect(engine).get_table_names())
    assert {"workspaces", "users", "datasets", "dataset_versions", "cases", "experiments", "case_runs", "scores", "jobs", "review_assignments"} <= tables
    downgrade = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "base"],
        cwd=project_dir,
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert downgrade.returncode == 0, downgrade.stderr
    assert "cases" not in inspect(engine).get_table_names()
    engine.dispose()
