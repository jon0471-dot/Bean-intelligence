# BEAN Intelligence — Licensing & Compliance Review

**Reviewed:** 2026-10-24
**Scope:** every inference integration BEAN ships today, plus candidates under evaluation.

## 1. Active integrations

### bean-llm-hosted-primary / bean-code-llm-hosted-primary (RIISHE, CODE GIFTZ)
- **Arrangement:** authorized hosted inference via the platform's gateway. BEAN consumes
  an API, not model weights.
- **Rights:** access governed by the platform inference agreement under which this
  deployment operates. No weight redistribution occurs. Customer-facing branding remains
  BEAN's; no upstream model identity is claimed or displayed.
- **Resale posture:** BEAN sells its own application layer (products, routing, UX), not
  the upstream model. Terms of the underlying agreement must continue to permit hosted
  API resale — reviewed as part of the platform operator's authorization.
- **Data handling:** prompts/completions are processed by the provider under its terms.
  Documented in the privacy section of SECURITY.md.

### bean-image-hosted-primary (LAXII)
- Same arrangement as above. Generated images are delivered to the requesting customer.
  BEAN asserts no ownership over upstream weights and does not store provider secrets in
  client-facing code.

## 2. Candidates under evaluation (not deployed)

| Candidate | Product | License | Commercial use | Source | Verified |
| --- | --- | --- | --- | --- | --- |
| Qwen2.5-Coder-14B-Instruct | CODE GIFTZ / RIISHE | Apache-2.0 | Yes (per-size check required — some Qwen2.5 sizes use the Qwen license) | https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct | 2026-10-24 |
| Qwen2.5-7B-Instruct | RIISHE | Apache-2.0 | Yes | https://huggingface.co/Qwen/Qwen2.5-7B-Instruct | 2026-10-24 |
| FLUX.1-schnell | LAXII | Apache-2.0 | Yes | https://huggingface.co/black-forest-labs/FLUX.1-schnell | 2026-10-24 |
| FLUX.1-dev | LAXII | FLUX.1-dev Non-Commercial License | **No** (without separate BFL agreement) | https://github.com/black-forest-labs/flux | 2026-10-24 |
| Wan2.2-TI2V-5B / A14B | JAZMII | Apache-2.0 | Yes | https://github.com/Wan-Video/Wan2.2 | 2026-10-24 |
| HunyuanVideo | JAZMII | Tencent Hunyuan community license | **Restricted** — requires legal review | https://github.com/Tencent-Hunyuan/HunyuanVideo (LICENSE.txt) | 2026-10-24 |

## 3. Rules enforced by this review

1. **No license assumptions.** Open-weight ≠ open-source ≠ commercially resellable. Each
   candidate is checked on its official model card before it can move to `enabled: true`
   in the private registry (`src/lib/registry/backends.ts`).
2. **Heterogeneous families get per-size review** (e.g. Qwen2.5's mixed licensing).
3. **Non-commercial licenses are disqualifying** for hosted commercial products unless a
   separate agreement is obtained (FLUX.1-dev, HunyuanVideo today).
4. **Attribution and notice obligations** (licenses requiring notices) must be added to
   the platform's legal notices page before deployment of the corresponding backend.
5. **Provider terms flow through.** When an authorized hosted provider is used, its data
   handling, usage restrictions and privacy terms are disclosed to customers in the
   platform's terms of service; BEAN does not claim "fully local" processing when an
   external service processes requests.

## 4. Disclosure obligations (customer-facing)

- The terms of service must state that RIISHE/LAXII/CODE GIFTZ inference is processed by
  authorized third-party inference providers, and what data is transmitted (prompt text,
  parameters).
- The platform must not represent upstream foundation models as BEAN-trained.
- JAZMII's UI must continue to show that no video backend is deployed until one actually
  is.

## 5. Open items

- [ ] Obtain written authorization line for hosted-inference resale terms (operator task).
- [ ] If Wan2.2 is deployed: add Apache-2.0 notice file to `models/licenses/` and to the
      product legal notices.
- [ ] If HunyuanVideo is ever reconsidered: full legal review of Tencent's community
      license, including enterprise registration requirements.
- [ ] Container-based sandbox hardening decision (see SECURITY.md §sandbox) before
      offering CODE GIFTZ execution to untrusted tenants at scale.
