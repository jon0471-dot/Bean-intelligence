# BEAN Intelligence — Model Evaluation Report

**Verification date:** 2026-10-24
**Rule:** every claim below is sourced from the official model card/repository. Where a
provider does not disclose a checkpoint identity, the report records that fact instead of
guessing. Candidate status: `DEPLOYED`, `CANDIDATE`, `REJECTED`, `UNDER REVIEW`.

---

## RIISHE — Conversational AI

### Backend in use: authorized hosted inference gateway — `DEPLOYED`
- **Provider:** Z.ai authorized hosted inference gateway (managed SDK).
- **Model identity:** Provider-managed language model. **The exact checkpoint is not
  disclosed to tenants by the provider.** BEAN records this honestly rather than naming a
  model it cannot verify.
- **Verification performed (2026-10-24, this environment):**
  - Real completion probe PASS — 446 ms (`scripts/stage0-report.json`).
  - Streaming probe PASS — SSE `data:` frames parsed to deltas server-side.
  - Latency observed in production routes: ~0.5–5 s per completion.
- **Decision:** deployed as `bean-llm-hosted-primary`. No weights are redistributed or
  re-sold; access is governed by the platform inference agreement.

### Self-hosted candidate: Qwen2.5-Coder / Qwen2.5 family — `CANDIDATE (future)`
- **Sources:** https://huggingface.co/Qwen/Qwen2.5-7B-Instruct (license: apache-2.0),
  https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct (license: apache-2.0).
- **License check:** Apache-2.0 verified on the specific checked sizes (0.5B–14B Coder,
  7B Instruct). ⚠️ The Qwen2.5 family is heterogeneous — some sizes (3B, 72B) ship under
  the Qwen license instead. Verify per-size before any deployment.
- **Runtime compatibility:** vLLM / SGLang officially documented on the model card.
- **Hardware:** ~16–28 GB VRAM class for 7B–14B at FP16/AWQ; not feasible in the current
  environment (no GPU).
- **Decision:** documented candidate for a future self-hosted RIISHE tier. Not deployable
  here; no capability is claimed.

---

## LAXII — Image Generation AI

### Backend in use: authorized hosted inference gateway — `DEPLOYED`
- **Provider:** Z.ai authorized hosted inference gateway (managed SDK).
- **Model identity:** Provider-managed text-to-image model; **exact checkpoint not
  disclosed to tenant**.
- **Verified behavior (2026-10-24):**
  - Real generation PASS — 47,435-byte JPEG in 59.4 s (probe), 78,652-byte JPEG in ~65 s
    (production route).
  - Output format: JPEG (magic bytes `FF D8 FF` verified), NOT PNG — recorded and surfaced
    in the UI.
  - Supported sizes (enforced server-side): 1024x1024, 768x1344, 864x1152, 1344x768,
    1152x864, 1440x720, 720x1440.
- **Decision:** deployed as `bean-image-hosted-primary`. Image-to-image is NOT exposed —
  the configured backend does not offer a verified img2img path.

### Self-hosted candidate: FLUX.1-schnell — `CANDIDATE (future)`
- **Source:** https://huggingface.co/black-forest-labs/FLUX.1-schnell ;
  https://github.com/black-forest-labs/flux (license table).
- **License check:** Apache-2.0 — commercial use permitted (verified 2026-10-24).
- **Constraints:** 12B params, ~24 GB VRAM recommended for FP16; 1–4 step generation.
- **REJECTED alternative:** FLUX.1-dev — license is the **FLUX.1-dev Non-Commercial
  License**; incompatible with a commercial hosted service without a separate agreement.

---

## JAZMII — Video Generation AI

### Backend in use: **NONE — product truthfully unavailable** (`UNDER REVIEW`)
- No GPU capacity and no authorized hosted video endpoint exists in this environment.
- The router rejects all video requests with a stable `NO_BACKEND` error and records the
  job as `unsupported`. **BEAN does not simulate video jobs.**

### Candidate: Wan2.2 (Wan-AI) — `CANDIDATE (primary)`
- **Sources:** https://github.com/Wan-Video/Wan2.2 (Apache-2.0 license),
  https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B,
  https://docs.comfy.org/tutorials/video/wan/wan2_2.
- **License check:** Apache-2.0 — commercial use permitted (verified 2026-10-24).
- **Real constraints (from the official card):**
  - `Wan2.2-TI2V-5B`: text-to-video + image-to-video, 720P @ 24fps, consumer GPU class
    (RTX 4090 listed by the authors); high-compression VAE (16x16x4).
  - `Wan2.2-T2V-A14B` / `I2V-A14B`: 5-second clips at 480P/720P, MoE 14B — multi-GPU class.
- **What BEAN would honestly advertise if deployed:** 5 s clips, 720P@24fps for the 5B
  tier, per-clip latency in the minutes range on a single consumer GPU. Nothing beyond
  that until measured.

### Candidate: HunyuanVideo (Tencent) — `REJECTED (for now)`
- **Source:** https://github.com/Tencent-Hunyuan/HunyuanVideo (LICENSE.txt).
- **Reason:** custom Tencent community license with commercial-use restrictions
  (registration/enterprise terms rather than a simple permissive license). Rejected until
  legal review obtains authorization. BEAN does not assume the license permits resale.

---

## CODE GIFTZ — Coding AI

### Backend in use: hosted gateway (generation) + BEAN restricted sandbox (execution) — `DEPLOYED`
- **Generation:** same authorized hosted LLM as RIISHE (registered separately as
  `bean-code-llm-hosted-primary`), with code-specific system prompts and file extraction.
- **Execution:** BEAN-local restricted sandbox — child-process isolation, 15 s SIGKILL
  timeout, minimal environment (no secrets, no DATABASE_URL), output capped at 64 KB,
  ephemeral workspaces under `sandbox-runs/`, explicit per-run user approval.
- **Verified end-to-end (2026-10-24):** LLM generated `main.js` implementing isPalindrome
  with self-tests; sandbox executed it — exit 0, `PASS: …` x3, 31 ms. FizzBuzz task also
  verified from the browser (exit 0, `DONE`).

### Self-hosted candidate: Qwen2.5-Coder-14B-Instruct — `CANDIDATE (future)`
- **Source:** https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct (license: apache-2.0).
- **Runtime:** vLLM officially documented. ~28 GB VRAM FP16 (or quantized variants).
- **Decision:** candidate for a future self-hosted CODE GIFTZ generation tier.

---

## Environment feasibility statement (truthful)

| Resource | Available here | Consequence |
| --- | --- | --- |
| GPU | None | JAZMII cannot run; no self-hosted model tiers deployed |
| Authorized hosted inference (LLM) | Yes | RIISHE + CODE GIFTZ generation live |
| Authorized hosted inference (image) | Yes | LAXII live, ~60 s per image, JPEG output |
| Durable storage | Local disk | Image artifacts + job records persisted |
| Container runtime (for sandbox hardening) | Not available to the app | Sandbox is process-level; containerization documented as required hardening |

**Bottom line:** two products fully operational on real inference (RIISHE, LAXII), one
product fully operational end-to-end with local execution (CODE GIFTZ), and one product
(JAZMII) honestly blocked pending a licensed GPU deployment path.
