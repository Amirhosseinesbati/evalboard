# ADR 0002 — Database-backed work ownership

Status: accepted for v1.

Use a durable database work claim with a lease and a unique case-run key. A LangGraph checkpoint is for resumable flow state; it does not wake a job after a process crash. A worker may reclaim expired work, and committed outputs must remain reusable. This avoids adding a second queue service to the pilot.
