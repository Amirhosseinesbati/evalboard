import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_temp_root = Path(__file__).resolve().parents[1] / ".test-tmp"
_temp_root.mkdir(exist_ok=True)
_test_dir = Path(tempfile.mkdtemp(prefix="evalboard-tests-", dir=_temp_root))
os.environ["DATABASE_URL"] = f"sqlite:///{(_test_dir / 'test.db').as_posix()}"
os.environ["EVALBOARD_DEMO"] = "true"

from evalboard.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def admin(client: TestClient):
    browser = TestClient(app)
    response = browser.post("/api/v1/auth/login", json={
        "username": "admin@northstar.example.com",
        "password": "Demo123!",
    })
    assert response.status_code == 200
    yield browser
    browser.close()
