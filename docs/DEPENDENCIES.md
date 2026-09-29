# Dependencies and tested environment

The Python lockfile is `apps/api/uv.lock`; the web lockfile is `apps/web/pnpm-lock.yaml`. Use locked installs for repeatable local, CI, and container builds. Container tags are pinned in `compose.yaml` and each Dockerfile. Update this record only after executing a check.

## Python

On 2026-09-28, dependency resolution and `uv sync --frozen` succeeded on Windows with Python 3.12.13 and uv 0.11.28. The resolved versions reported by the install were:

| Package | Resolved version |
| --- | ---: |
| FastAPI | 0.141.1 |
| Pydantic | 2.13.5 |
| SQLAlchemy | 2.1.1 |
| Alembic | 1.20.0 |
| LangChain | 1.4.2 |
| LangGraph | 1.2.12 |
| langchain-openai | 1.6.6 |
| pytest | 9.1.1 |
| Ruff | 0.16.9 |
| mypy | 1.20.2 |

The experiment-graph backend suite passed 15/15 tests; four later adapter-validation checks passed. Ruff and mypy passed after the retention addition, with mypy checking 17 source files. The new Markdown and retention core assertions passed directly; a fresh full pytest run after those additions did not complete on this host. Detailed application evidence is recorded in `docs/EVALUATION.md`. Current LangChain and LangGraph implementation choices were checked against their official agent, structured-output, persistence, and interrupt documentation on 2026-09-28.

## Web

Node.js 24 and pnpm 11.19.0 are the selected runtime and package manager. The locked web install succeeded on 2026-09-28. Resolved versions include React 19.3.0, Vite 8.3.1, Tailwind CSS 4.3.3, TypeScript 5.9.3, React Query 5.104.0, and ESLint 10.11.0. `pnpm run lint`, `pnpm run typecheck`, and `pnpm run build` all passed sequentially on Windows. Four primary Playwright journeys and one later focused modal-keyboard journey passed with one worker against the local seeded API.

## Containers and deployment

`compose.yaml` uses the locally available `postgres:17.11-alpine3.24`. The API Dockerfile targets `python:3.12.14-slim-bookworm` and the web Dockerfile targets `node:24.13.0-alpine3.23`. On 2026-09-28, Docker Desktop 4.49.0 built `evalboard-api:0.1.0` and `evalboard-web:0.1.0` successfully from their lockfiles. The API image installed 77 locked packages and the web image installed 185 locked packages. The API build context is limited by `apps/api/.dockerignore`.

`docker compose config --quiet` passed. The first PostgreSQL tag (`17.10-bookworm`) could not be downloaded because Docker's blob endpoint returned HTTP 403, so Compose was switched to the already cached exact `17.11-alpine3.24` tag. The first Compose attempt lost its `containerd` connection and the Docker Desktop backend logged a `dockerInference` socket error. A later `docker compose up -d --no-build --pull never` reached healthy PostgreSQL and `init` exit 0; Alembic migration and synthetic seed succeeded. The API started initially, but Docker subsequently returned `input/output error` reading logs, images, and containerd metadata. A follow-up `docker compose build api` failed on containerd `meta.db` with I/O error. Host C: free space was raised from about 0.01 GB to about 5 GB by reversibly moving old temporary trace files, but the error persisted. This project's services were stopped without restarting Docker globally because unrelated containers were active. API/worker/web container smoke remains **unverified**. Check base-image updates and package licenses before redistribution.

Official references: [LangChain](https://docs.langchain.com/oss/python/langchain/agents), [LangGraph](https://docs.langchain.com/oss/python/langgraph/persistence), [FastAPI](https://fastapi.tiangolo.com/), [SQLAlchemy](https://docs.sqlalchemy.org/), [Docker Postgres](https://hub.docker.com/_/postgres), [Docker Python](https://hub.docker.com/_/python), [Docker Node](https://hub.docker.com/_/node).

## Preliminary license inventory

Direct installed-package metadata was checked on 2026-09-28: most Python/web runtime packages report MIT; `httpx` and `uvicorn` report BSD-3-Clause; `python-multipart` and TypeScript report Apache-2.0; `lucide-react` reports ISC; `psycopg`/`psycopg-binary` 3.3.6 report LGPL-3.0-only. This check excludes transitive dependencies and container layers. Keep notices and a complete SBOM with any redistributed build, and review LGPL terms for the delivery format.
