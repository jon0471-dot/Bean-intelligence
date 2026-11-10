# RIISHE evaluation — consolidated results (2026-11-01)

Consolidated from 13 measured runs in evals/riishe/results/ (latest outcome per question/mode).
Runs today: results-1792920874756.json (5q), results-1793539293202.json (2q), results-1793539502808.json (14q), results-1793539851179.json (4q), results-1793540019428.json (4q), results-1793540107806.json (1q), results-1793540205122.json (1q), results-1793540327249.json (1q)

NOTE: the upstream gateway enforced 429 rate limits during the burst; several runs carry
honest 429 errors (reported as inconclusive, not failures).

| Category | Baseline | Upgraded | Notes |
|---|---|---|---|
| abstention | 5/6 | 5/6 | 1 upgraded run(s) errored (429-throttled) — inconclusive |
| coding-debugging | 2/2 | 2/2 |  |
| conversation-context | 0/1 | 1/1 |  |
| current-web-research | 0/1 | 1/1 |  |
| general | 4/4 | 4/4 |  |
| general-knowledge | 2/2 | 2/2 |  |
| injection | 1/2 | 2/2 |  |
| math | 6/7 | 7/7 |  |
| movie-release-research | 0/1 | 1/1 |  |
| multi-step-reasoning | 1/2 | 2/2 |  |
| multilingual | 2/2 | 2/2 |  |
| pdf-document-qa | 0/1 | 1/1 |  |
| research | 0/3 | 3/3 |  |
| software-version-verification | 0/1 | 1/1 |  |
| spreadsheet-analysis | 0/1 | 1/1 |  |
| tool-calling | 0/1 | 0/1 | 1 upgraded run(s) errored (429-throttled) — inconclusive; EXECUTION_VERIFIED reached (sandbox ran, ok:true) in 3 consecutive later runs; final-value restatement model-variable |
