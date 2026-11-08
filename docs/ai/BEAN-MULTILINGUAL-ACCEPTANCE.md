# BEAN Multilingual Acceptance

**Status:** Verified 2026-11-08 (eval harness `scripts/world-eval/run.ts`, evidence `scripts/world-eval/out/evidence.jsonl`; commits `68d7590`, `d1ad9bb`).

## 1. What was accepted

The multilingual layer (`src/lib/intel/language.ts`, `intel/crosslingual.ts`, RIISHE protocol wiring) against the brief's test languages: English, Tamil, Hindi, Malayalam, Arabic, Spanish, Chinese, Japanese and mixed-language prompts.

## 2. Measured results (live eval run, 2026-11-08)

| Case | Input | Detected | Confidence | Latency | Result |
| --- | --- | --- | --- | --- | --- |
| English | "What is the tallest mountain in the world?" | en | 0.87 | 1–3 ms | PASS |
| Tamil | "தமிழ்நாட்டின் தலைநகர் எது? எனக்கு சொல்லுங்கள்" | ta | 0.99 | <1 ms | PASS |
| Hindi | "भारत की राजधानी क्या है और यह कब स्थापित हुई?" | hi | 0.99 | <1 ms | PASS |
| Malayalam | "കേരളത്തിലെ തലസ്ഥാനം ഏതാണ്? എനിക്ക് പറയൂ" | ml | 0.99 | <1 ms | PASS |
| Arabic | "ما هي عاصمة مصر وما هو عدد سكانها؟" | ar | 0.99 | 0–1 ms | PASS |
| Spanish | "¿Cuál es la capital de Argentina…?" | es | 0.80 | <1 ms | PASS |
| Chinese | "中国的首都是哪里？请告诉我它的历史" | zh | 0.99 | <1 ms | PASS |
| Japanese | "日本の首都はどこですか？教えてください" | ja | 0.95 (mixed) | <1 ms | PASS |
| Mixed Tamil+English | "தமிழ்நாடு பற்றி tell me the history of its temples" | ta + mixed flag | 0.99 | <1 ms | PASS |
| Transliteration | "vanakkam, eppadi irukkinga…" | transliterated flag, English confidence lowered | — | <1 ms | PASS (unit) |

**9/9 language cases pass.** Detection is pure Unicode-script + function-word arithmetic — the entire classification layer costs under 1 ms per prompt against the brief's 1–3 s budget.

## 3. Cross-lingual retrieval behavior

- Search-language policy: original language FIRST, English added for non-English prompts (`searchLanguagesFor`, unit-pinned).
- English query variant: one bounded model call (≤6 s, cached, proper nouns preserved verbatim) — unit-tested with an injected transport (Tamil officeholder question → "Who is the current chief minister of Tamil Nadu"; failure → honest note, original-language-only search).
- **Live runs during the acceptance window were throttle-blocked**: the platform gateway was inside a measured account-wide HTTP 429 window across ALL endpoint classes (functions/chat/images) during every eval attempt. Per the binding no-retry-storm policy each case made a single attempt and reported the throttle honestly (`cross-lingual expansion unavailable; searched in Tamil only`). The deterministic policy/routing around it still passed (`policy-officeholder` PASS). A later bounded attempt recorded in the evidence file supersedes this section when the window closes.

## 4. Same-language answering (RIISHE)

Every turn now runs script-level language detection; non-English turns append the multilingual answer protocol: answer in the user's language even when all evidence is English, keep names/measurements verbatim, express uncertainty and source conflicts in the user's language. This rides the previously measured Tamil-response capability (a9106bd acceptance: real Tamil multilingual response) and adds the evidence-language discipline.

## 5. Honesty contract honored

- Low-confidence detection is REPORTED (short Latin fragments cap at ≤0.55; a degraded note is attached when generation proceeds under low confidence).
- Undetermined inputs fall back to searching the ORIGINAL text (never dropped).
- The transliterated-Indian-language marker list is conservative; false positives only lower English confidence — they never change routing unilaterally.

## 6. Known limits (stated, not hidden)

- Spanish vs English separation relies on function words; very short Spanish fragments without function words may read as low-confidence English (original wording is always the first query, so retrieval still works).
- Korean and other unsupported scripts detect as `und` at low confidence and are served best-effort — never claimed as supported languages.
- Query TRANSLATION quality depends on the bounded model call; failure degrades to original-language-only search (recorded, visible in `degraded`).
