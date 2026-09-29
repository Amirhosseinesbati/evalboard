# ADR 0001 — Modular monolith

Status: accepted for v1.

Keep API, domain logic, adapters, evaluators, and run orchestration in one Python package with a separate worker process. This keeps authorization and data transactions in one codebase while allowing expensive evaluations outside HTTP requests. A service split can follow actual load or team boundaries later.
