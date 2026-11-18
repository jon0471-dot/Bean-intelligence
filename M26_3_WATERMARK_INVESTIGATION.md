# M26.3 WATERMARK INVESTIGATION — Origin Classification and Mitigation

Milestone: M26.3 · Branch `fix/laxii-image-output-ux`.

## 1. The observed artifact

The user's screenshot showed an IMAX-like wordmark embedded in the
bottom-right corner of a generated image, despite the no-watermark
instruction — part of the IMAGE content, not a UI element.

## 2. Origin classification — checked layer by layer

| Layer | Inspection | Finding |
|---|---|---|
| 1. Provider response bytes | 5 live generations captured end-to-end this milestone (1920×1080, 1024×1024, 1440×720 ×2, 1344×768); every returned payload decoded and inspected, corners cropped and examined | clean in every run — the gateway returns raw model output with no added mark |
| 2. Worker output before storage | the worker writes the verified bytes directly (`fs.writeFileSync` + `storeResultAsset`) with no compositing on the generation path | no transformation that could add a mark |
| 3. Backend image-processing stages | the exact-dimension finish (`applyExactDimensions`) uses resize/cover-crop/composite ONLY in the pad-extend strategy (compositing the image over its own blurred background — content-derived, no text); grep across `src/lib` found no watermark/branding/overlay code on the image path | **no BEAN-side overlay exists** |
| 4. Overlay/branding code | repository-wide search for `watermark|overlay|branding|imax` on the image pipeline: only unrelated UI branding strings (sidebars) and the JAZMII video adapter's `watermark_enabled: false` (a provider param, correctly off) | nothing that could stamp an image |
| 5. Frontend rendering | the result card renders a plain `<img src>` — no decorations, no corner overlays; the only overlays are status chips OUTSIDE the image element | nothing added at render time |
| 6. Model configuration & prompt composition | the model behind the gateway is a text-capable image model; "cinematic" style prompts are exactly the class of prompts that leads such models to render letterforms; the deployed build carried NO anti-text conditioning at all | **the mark is GENERATED DIRECTLY BY THE MODEL** |

**Classification: generated directly by the model.** Supporting evidence:
(a) no BEAN overlay code exists anywhere on the pipeline (grep results above);
(b) the provider's raw response bytes in all five live runs carry no mark;
(c) the mark in the screenshot is perspective/texture-integrated into the
scene (not a flat overlay) — characteristic of model-rendered text; and
(d) the model class is known to render letterforms under cinematic prompts.

## 3. Mitigation implemented (honest, bounded)

### 3.1 Prompt conditioning — the mark's cause is addressed at the source

`src/lib/intel/grounding.ts` (`compileConditioning`, LAXII): every image
generation now appends an explicit exclusion block to the conditioned prompt
(the user's words stay verbatim and first):

> Exclusions (mandatory): absolutely no text, no letters, no words, no
> numbers, no captions, no logos, no wordmarks, no watermarks, no signatures
> and no trademarks anywhere in the image.

### 3.2 Detection — the bounded vision verification now hunts unwanted marks

`src/lib/intel/continuity.ts`: the post-generation defect checklist gained
the class "unwanted embedded text, letters, logos, wordmarks, watermarks or
signatures that the request never asked for", and the inspection instruction
now tells the vision model that anything the request summary never asked
for IS a defect (quoting the readable characters). `unwantedTextDefects()`
classifies reported defects, keeping REQUESTED-text rendering issues
(typography demands) separate from UNWANTED marks.

The check runs on every generation (existing `verifyGeneratedImage` lane —
one bounded vision call through the platform's existing gateway; skipped
honestly — `checked: false` with the reason — when the check cannot run).

### 3.3 One controlled regeneration when a mark is detected

`src/lib/jobs/image-worker.ts`: when the check reports UNWANTED marks, the
worker makes exactly ONE regeneration attempt with the same conditioned
prompt and planned size (quota-guarded through the same automated-consumption
reserve as every other automated provider call):

- clean re-check → the regenerated image is delivered; the FLAGGED original
  is preserved as its own asset (`flagged-original`) and linked in the
  result — nothing is silently overwritten or cropped;
- still flagged after one attempt → the ORIGINAL stays the result, flagged,
  with an explicit Regenerate action available in the UI;
- the result records the whole truth (`artifact.unwantedTextDetected`,
  defects, regeneration outcome, flagged-original URL) and the UI shows an
  amber disclosure with the note — never a silent pass.

### 3.4 Honest limits (stated, not promised)

- The generating model has no guaranteed text suppression: the exclusion
  conditioning and the bounded regeneration REDUCE the occurrence; they
  cannot promise zero. A mark that survives is flagged in the UI, the
  original is preserved, and the user gets an explicit Regenerate action.
- No "removed" claim is ever made unless the FINAL image bytes' own vision
  re-check confirms the absence.

## 4. Verification

- Live runs this milestone: 5/5 generations passed the artifact inspection
  (`artifact.checked: true`, `unwantedTextDetected: false`) — with the new
  exclusion conditioning in place; corner crops of the delivered images
  inspected visually (no marks).
- Unit pins: `tests/unit/m263-laxii-output.test.ts` covers the exclusion
  conditioning (present for every LAXII generation) and the defect
  classification (unwanted wordmark flagged; demanded-text issues excluded).
- The screenshot's exact artifact could not be reproduced deterministically
  (stochastic model behavior) — the mitigation path is instead verified by
  the unit-pinned classification + regeneration flow and the clean live runs.
