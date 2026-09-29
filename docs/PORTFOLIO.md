# EvalBoard — independent portfolio project

EvalBoard is a self-hostable evaluation workbench for small AI product teams. It pairs two target configurations over one immutable dataset version, keeps failures in the denominator, exposes example-level evidence, and produces an explicit release decision. The supplied support scenario and historical runs are synthetic demonstration material.

## Case study

The design problem is that a single aggregate score can hide costly regressions: a faster support assistant may answer return-policy questions incorrectly. EvalBoard organizes the decision around paired cases, task-specific metrics, a failure explorer, blinded human review, and a report that records thresholds, counts, configuration versions, and unresolved costs. The implementation uses a Python API and durable worker with a React console. Connected model quality is not claimed without a live, representative experiment.

## 60–90 second demo script

1. Open the synthetic dataset and show task and split counts.
2. Start or open a paired experiment. Explain that both candidates receive identical cases.
3. In comparison, filter return-policy regressions and open the exact output and reference evidence.
4. Open a blinded review item, record a decision, and show disagreement if present.
5. Open the release report, explain the gate result and known/unknown costs, then download JSON.

## 3–5 minute technical walkthrough

1. Show the JSONL schema, row errors, immutable dataset versions, and split isolation.
2. Trace an experiment from API request to durable work claim, target adapter, recorded output, evaluator plugins, and stored scores.
3. Show pause/cancel and the rule that a timeout remains in the denominator. Explain recovery after a worker restart.
4. Show workspace authorization, server-side secret references, and a blinded review payload.
5. Explain report reproducibility, CI exit status, and why fixture validation is separate from model-quality evidence.

## Content angles

- Why paired evaluation surfaces regressions an average score can conceal.
- How durable case keys and output-before-scoring make retries auditable.
- How a release gate can combine deterministic checks with human review without inventing a universal quality score.

## Screenshots

Eight screenshots were captured from the running seeded local app on 2026-09-28 using one headless Chrome session. The capture manifest recorded **zero page/console errors and zero horizontal overflow**. Desktop, tablet, and mobile images were visually inspected; the failure image shows a real planted timeout, and the reviewer image uses the restricted reviewer account.

| View | Viewport | Evidence |
| --- | --- | --- |
| Dataset list and count | 1440 px | [01-datasets-1440.png](screenshots/01-datasets-1440.png) |
| Experiment builder | 1024 px | [02-experiment-builder-1024.png](screenshots/02-experiment-builder-1024.png) |
| Persisted run table | 1440 px | [03-live-run-1440.png](screenshots/03-live-run-1440.png) |
| Paired comparison | 1440 px | [04-comparison-1440.png](screenshots/04-comparison-1440.png) |
| Failure explorer | 1440 px | [05-failure-explorer-1440.png](screenshots/05-failure-explorer-1440.png) |
| Failing release report | 1440 px | [06-release-report-1440.png](screenshots/06-release-report-1440.png) |
| Mobile comparison | 390 px | [07-mobile-comparison-390.png](screenshots/07-mobile-comparison-390.png) |
| Restricted blinded review | 1440 px | [08-blinded-review-1440.png](screenshots/08-blinded-review-1440.png) |

Capture details are in [manifest.json](screenshots/manifest.json). These are interface evidence from synthetic data, not measured live-model quality.

## Resume bullet templates

- Built an independent, self-hostable AI evaluation workbench with versioned datasets, paired execution, case-level evidence, blinded review, and release reports; a local synthetic run completed **240/240 pairs** with one worker.
- Implemented task-specific evaluators and durable worker recovery; in a process interruption exercise, one in-flight attempt was marked uncertain and **zero duplicate score keys** were recorded after restart.

Add numerical quality, latency, cost, or reliability claims only after a measured run with documented numerator, denominator, and environment.
