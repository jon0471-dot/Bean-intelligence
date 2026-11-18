# M26.3 ASPECT RATIO FIX — Root Cause, Measured Provider Contract and the Corrected Size System

Milestone: M26.3 · Branch `fix/laxii-image-output-ux`.

## 1. The full request path traced

Every layer of the 1920×1080 flow was traced in the code at the starting
branch (`411437144ee01abac07d7f0693cfaac0f6101e41`):

1. **Composer selector** (`src/components/bean/laxii.tsx`): presets come from
   the registry (`LAXII_SIZES`); custom mode posts `{width, height}` via
   `sizeOverride`. Both paths verified against the live API.
2. **Chat route** (`src/app/api/laxii/chat/route.ts`): NL size hints
   (`extractSize`) and `sizeOverride` resolve into `{prompt, width, height}`
   or `{prompt, size}` job params — both preserved.
3. **Generate route** (`src/app/api/laxii/generate/route.ts`): same contract
   (preset enum or custom width/height).
4. **Worker** (`src/lib/jobs/image-worker.ts`): `planExactDimensions(target)`
   picks a provider-native generation size + finish strategy, generates,
   then finishes to the EXACT requested pixels and verifies from decoded
   bytes.
5. **Adapter** (`src/lib/adapters/hosted-image.ts`): passes a literal size
   to the gateway images endpoint.
6. **Renderer**: result card shows the measured final dimensions.

The composer→job→finish path was verified LIVE at the branch base: a
1920×1080 request already delivered exactly 1920×1080 bytes (cover-crop
finish from 1344×768, 1.6% discarded). The screenshot's delivered square
(1312×1312) is the provider's own square default — 1312 = 41×32 satisfies
its real contract — which the DEPLOYED build surfaced when either the
provider ignored the requested size or one of the two BROKEN presets was
selected. Both root causes are fixed here.

## 2. The root cause: the advertised size list violated the provider's real contract

A live generation attempt returned the provider's own validation error
(HTTP 400, code 1214), quoted verbatim:

> `size的长宽均需满足512px-2880px之间,且为32整数倍,并保证最大像素数不超过2^22px`

Translation: **both sides must be within 512–2880 px, both must be multiples
of 32, and total pixels must not exceed 2²²**.

Against that contract the old registry was wrong in two ways:

| Old "native" size | 32-aligned? | Result |
|---|---|---|
| 1440×720 (Wide 2:1) | 720 = 22.5×32 → **NO** | every generation planned onto it failed HTTP 400 after quota spend |
| 720×1440 (Tall 1:2) | **NO** | same failure |
| 1024×1024, 768×1344, 864×1152, 1344×768, 1152×864 | YES | worked |

And the provider DOES offer exact 16:9/9:16 natively — the old list simply
never used them. The corrected set (all validated by the contract):

| Size | Alignment | Pixels | Aspect |
|---|---|---|---|
| 1024×1024 | 32×32 | 1,048,576 | 1:1 |
| 768×1344 | 24×42 | 1,032,192 | 4:7 |
| 864×1152 | 27×36 | 995,328 | 3:4 |
| 1344×768 | 42×24 | 1,032,192 | 7:4 |
| 1152×864 | 36×27 | 995,328 | 4:3 |
| **2048×1152** | 64×36 | 2,359,296 | **16:9 exact** |
| **1152×2048** | 36×64 | 2,359,296 | **9:16 exact** |
| **2048×1024** | 64×32 | 2,097,152 | 2:1 |
| **1024×2048** | 32×64 | 2,097,152 | 1:2 |

## 3. What changed

| Layer | Change |
|---|---|
| `src/lib/laxii/dimensions.ts` | corrected `NATIVE_SIZES`; new `PROVIDER_SIZE_CONTRACT` + `isValidProviderSize()` (the measured rule); new `planFinishStrategy(actual, target)` — the least-loss finish (resize / cover-crop ≤15% / blurred pad-extend) computed from the provider's ACTUAL output; new `aspectRatioLabel(finalWidth, finalHeight)` (gcd-reduced honest label) |
| `src/lib/registry/products.ts` | `LAXII_SIZES` mirrors the 9 corrected natives incl. "Landscape 16:9" / "Portrait 9:16"; the two broken presets removed |
| `src/lib/adapters/hosted-image.ts` | `SUPPORTED_SIZES` mirrors the corrected set (both generation and edit) |
| `src/lib/registry/backends.ts`, `src/lib/ai-engine/model-registry.ts` | backend `limits` lists corrected |
| `src/app/api/laxii/edit/route.ts`, `src/app/api/laxii/generate/route.ts` | size enums corrected (generate reads `LAXII_SIZES`) |
| `src/lib/laxii/intent.ts` | NL hints: "wide"/"tall" map to the valid 2:1/1:2 natives; **"16:9" now resolves to the EXACT 16:9 native (2048×1152)** instead of the 7:4 approximation |
| `src/lib/jobs/image-worker.ts` | (a) hard pre-flight guard: the planned size is validated against the measured contract BEFORE the provider call (fail fast, no quota spend); (b) provider-size mismatch RESILIENCE: when the provider answers with different dimensions (the field's square default), the ACTUAL bytes are finished to the exact requested target with `planFinishStrategy` — never failing the job for a survivable mismatch, never stretching (fit:fill is never used on a mismatched aspect), never cropping beyond 15%; (c) the whole truth persisted (see §4) |

## 4. Resolution metadata (requested vs generated vs final — persisted separately)

Every generation result now carries the honest block (also rendered on the
result card):

```json
{
  "width": 1920, "height": 1080,
  "aspectRatio": "16:9",
  "model": "Provider-managed text-to-image model; exact checkpoint not disclosed to tenant",
  "generation": {
    "requested": "1920x1080",
    "generated": "2048x1152",
    "strategy": "resize",
    "note": "same aspect ratio — high-quality scale, no crop and no distortion"
  },
  "artifact": { "checked": true, "unwantedTextDetected": false, "checkedAt": "…" }
}
```

- `requested` — the user's selection (persisted from the job params).
- `generated` — the model-native size actually requested from the provider.
- `providerReturned` / `finishStrategy` / `finishCropLossPct` / `finishPaddedAreaPct`
  — present ONLY when the provider ignored the plan (measured mismatch path).
- final `width`/`height` — always measured from the final encoded bytes;
  a mismatch rejects the artifact.

## 5. Live verification (production build, real provider, 2026-11-18)

| Request | Plan | Provider returned | Delivered (measured from bytes) | Aspect label |
|---|---|---|---|---|
| 1024×1024 | native | 1024×1024 | **1024×1024** | 1:1 |
| 1440×720 (previously ALWAYS HTTP 400) | resize from 2048×1024 | 2048×1024 | **1440×720** | 2:1 |
| 1920×1080 | resize from 2048×1152 | 2048×1152 | **1920×1080** | 16:9 |

All three artifact checks ran (vision inspection); no unwanted marks. The
16:9 delivery is now a ZERO-LOSS same-aspect scale from the true 16:9 native
— the old cover-crop (1.6% discarded composition) is gone entirely.

## 6. What is explicitly NOT done

- **No stretching**: `fit: 'fill'` is only ever applied when the aspect is
  already identical (a geometrically exact scale); mismatched aspects use
  cover-crop (≤15%) or pad-extend.
- **No silent subject cropping**: >15% crop switches to blurred edge-derived
  padding, and every strategy is disclosed in the UI.
- **No fake labels**: the UI shows the FINAL measured dimensions and the
  finish strategy; a square result is never labeled 16:9.
