# Security model

EvalBoard is designed for a one-customer-per-installation pilot with workspace-scoped data. Admin, operator, viewer, and restricted reviewer roles are separate. The reviewer role can access blinded assignments/decisions but not datasets, configs, results, comparisons, reports, or event streams. Every resource request must be authorized by workspace and role; an object or LangGraph thread ID is not authority. The two demo workspaces exist to test that boundary.

## Sensitive data

Provider credentials live in environment or a customer-managed secret store. HTTP targets are admin-configured and may reference only dedicated `EVALBOARD_TARGET_*` environment variables. Target API responses expose only whether a secret reference is configured, and candidate options are restricted to validated non-secret fields. Do not place credentials in browser state, datasets, prompts, logs, traces, or reports. Sessions use random opaque database-backed tokens, stored as hashes. Use HTTPS and `SESSION_COOKIE_SECURE=true` at deployment. Replace all demo passwords before shared use.

Inputs, retrieved documents, candidate outputs, and target tool results are untrusted data. They cannot alter evaluator policy, system prompts, endpoint allowlists, or release thresholds. Treat optional model-judge results as evidence for review, never as an instruction source or a sole proof of quality. Ground-truth answers stay outside the bundled target's retrieval context.

## Retention boundary

The local `evalboard redact` command requires database access, an exact workspace ID, an ISO cutoff, and `--apply --confirm-workspace-id` for mutation. It defaults to a read-only preview and targets only old terminal experiments. It clears stored run outputs, error text, review notes, score details, event kinds/payloads, and artifact content while preserving numeric scores, status, counts, timestamps, and a content-free audit summary. Reports identify redacted experiments. The command does not alter immutable dataset cases, shared recorded-target inputs, configuration prompts, database backups, application logs, external tracing systems, or existing exported files. Operators must separately manage those copies and use customer-specific deletion procedures for complete erasure.

## Imports and exports

Restrict JSONL size and content type, report row-level validation failures, and cap case counts and per-run work. Escape user-controlled text in the UI; sanitize rendered Markdown. If CSV export is introduced, escape spreadsheet formula prefixes. Do not fetch arbitrary user-supplied URLs. The HTTP adapter requires HTTPS, an exact origin allowlist, and a public DNS result, with redirects disabled. DNS can change between validation and connection, so a connected deployment also needs outbound network rules that deny local and private ranges.

## Deployment checklist

- Run with a non-demo database, HTTPS, secure cookies, backups, and restricted network exposure.
- Rotate credentials, remove or disable seeded demo users, and verify role/workspace isolation.
- Set worker concurrency, timeouts, retries, budgets, and retention for the customer.
- Review dependencies, container image patches, and applicable asset licenses before redistribution.
- Decide whether external tracing is allowed and redact sensitive fields before enabling it.

Passing local tests does not alone establish a production security review.
