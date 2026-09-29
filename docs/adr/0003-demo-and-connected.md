# ADR 0003 — Separate demo and connected adapters

Status: accepted for v1.

The synthetic support target and live adapters share a target contract but have explicit mode labels. A failed connected request never becomes synthetic success. This allows an offline demonstration without overstating model quality or hiding integration failures.
