from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./evalboard.db"
    evalboard_demo: bool = True
    session_cookie_secure: bool = False
    session_hours: int = 12
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    http_target_allowlist: str = ""
    max_import_bytes: int = 2_000_000
    worker_lease_seconds: int = 120
    worker_poll_seconds: float = 1.0
    request_timeout_seconds: float = 30.0
    openai_api_key: str | None = None
    langsmith_tracing: bool = False

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def allowed_http_origins(self) -> set[str]:
        return {x.strip().rstrip("/") for x in self.http_target_allowlist.split(",") if x.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
