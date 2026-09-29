# EvalBoard product

EvalBoard helps a small AI product team decide whether a candidate configuration can be released. The unit of comparison is a **paired case**: candidate A and candidate B receive the same versioned input. The workbench keeps per-case outputs, metric evidence, review decisions, and a reproducible report.

## Main workflow

1. Import JSONL cases or use the clearly marked synthetic demo dataset. Each case has a task type, split, tags, input, and applicable reference fields. Validation identifies the source row. A changed case produces a new immutable dataset version.
2. Define a target adapter and two configurations. The bundled support target makes the demo repeatable. An allowlisted HTTP target and configured model provider are separate connected paths. Secret values stay on the server.
3. Start a paired experiment. A durable worker records target output before metric scoring. The UI shows status, progress, partial failures, and cancellation.
4. Compare aggregates by task and metric, then open individual regressions and their evidence. Timeouts and failures remain in the denominator.
5. Review blinded examples, record notes and adjudication, and apply an explicit release gate. Export JSON or Markdown for CI and team discussion.

The workbench distinguishes deterministic fixture verification from live-model quality measurement. A synthetic result is not evidence that a real customer model improved. Unknown provider prices remain unknown.

## Roles and boundaries

An installation is intended for one customer. Its records are scoped by workspace. Admins configure and manage; operators run experiments; viewers inspect permitted results. A separate reviewer role sees only blinded assignments and decisions. Admin/operator review is masked in the interface but can be cross-checked against their access to unblinded results, so use the reviewer role for independent blinded scores. The demo has two fictional workspaces to exercise isolation. Demo access does not grant a bypass in a customer deployment.

## Out of scope for v1

Subscriptions, billing, public self-service signup, production traffic sampling, arbitrary target protocols, and replacing a tracing platform are not part of EvalBoard v1.
