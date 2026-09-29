"""Minimal Python client for the stable v1 JSON API."""

from typing import Any

import httpx


class EvalBoardClient:
    def __init__(self, base_url: str = "http://localhost:8000", timeout: float = 30) -> None:
        self.http = httpx.Client(base_url=base_url.rstrip("/") + "/api/v1", timeout=timeout, follow_redirects=False)

    def __enter__(self) -> "EvalBoardClient":
        return self

    def __exit__(self, *_args: object) -> None:
        self.http.close()

    def login(self, username: str, password: str) -> dict[str, Any]:
        return self._request("POST", "/auth/login", json={"username": username, "password": password})

    def import_jsonl(self, name: str, jsonl: str, description: str = "") -> dict[str, Any]:
        return self._request("POST", "/datasets/import", json={"name": name, "jsonl": jsonl, "description": description})

    def list_datasets(self) -> dict[str, Any]:
        return self._request("GET", "/datasets")

    def list_configs(self) -> dict[str, Any]:
        return self._request("GET", "/configs")

    def create_experiment(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/experiments", json=payload)

    def experiment(self, experiment_id: str) -> dict[str, Any]:
        return self._request("GET", f"/experiments/{experiment_id}")

    def comparison(self, experiment_id: str) -> dict[str, Any]:
        return self._request("GET", f"/experiments/{experiment_id}/comparison")

    def report(self, experiment_id: str) -> dict[str, Any]:
        return self._request("GET", f"/experiments/{experiment_id}/report")

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        response = self.http.request(method, path, **kwargs)
        response.raise_for_status()
        return response.json()
