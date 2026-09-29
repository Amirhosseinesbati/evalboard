# ADR 0004 — Per-task metrics and explicit release gate

Status: accepted for v1.

Each evaluator declares its unit, direction, applicability, and failure behavior. The report keeps counts and denominators per task and metric. The release gate compares declared thresholds rather than combining unrelated task scores into one number. This makes a regression inspectable and a decision reproducible.
