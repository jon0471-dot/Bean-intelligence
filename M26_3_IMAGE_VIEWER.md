# M26.3 IMAGE VIEWER — In-App Lightbox Implementation and Verification

Milestone: M26.3 · Branch `fix/laxii-image-output-ux`.

## 1. The problem

The result card's image had `onClick={() => window.open(src, '_blank', 'noopener')}`
— clicking a generated image opened the raw asset URL
(`/api/laxii/assets/{asset-id}`) as a standalone browser page, leaving the
LAXII workspace.

## 2. The implementation

New component: `src/components/bean/laxii/image-lightbox.tsx`, built on the
EXISTING Radix dialog infrastructure (`@/components/ui/dialog` — the same
primitive other BEAN surfaces use). No new dependency, BEAN dark/gold design
(`#f0c75e` accents, `rgba(212,175,55,…)` borders, near-black backdrop).

Wiring (`src/components/bean/laxii.tsx`):

- the result image's `onClick` now calls `onOpenViewer(src)` — with
  `stopPropagation()`/`preventDefault()` so no parent-card handler can fire;
- the lightbox is mounted at the WORKSPACE ROOT, so opening an image never
  changes the route and no state can be lost;
- the image list spans the conversation's completed results (built from the
  rendered thread), enabling next/previous navigation;
- compare-mode variants (before/diff) open as a single-image viewer when the
  clicked source is not the main result.

Behavior contract, as implemented:

| Requirement | How |
|---|---|
| Opens on click, stays on the workspace route | dialog portal; the URL is never touched |
| Full-resolution image | the same ownership-checked asset URL as `<img src>` |
| Fit-to-screen + zoom | object-contain fit; toolbar buttons + wheel + `+`/`-` keys; 100%–600% |
| Pan when zoomed | pointer-drag with clamped span; double-click toggles fit/2.5× |
| Escape closes | Radix dialog default |
| Backdrop click closes | Radix outside-click |
| Visible close button | toolbar ✕ + the dialog's own close affordance |
| Original image + asset ID preserved | viewer renders the SAME URL; download re-fetches it |
| Download without leaving | blob fetch → object URL → programmatic `<a download>`; the SPA never navigates |
| Next/previous across multiple results | arrow buttons + ArrowLeft/Right, "n / m" counter; hidden for a single image |
| Dark/gold design, desktop + mobile | toolbar layout tested at 1280×800 and 390×844 |
| No raw `<a>` navigation for preview | `window.open` removed from the image path (grep-verified) |
| Download / Copy / Edit further / Remove background / Enhance / Upscale intact | all original action buttons preserved untouched |
| No accidental activation of the card | portal + overlay absorb clicks; `stopPropagation` on open |

## 3. Verification (real browser, production build)

Driven with a headless Chromium session against the running production
server (`agent-browser`):

1. Signed in, opened the LAXII workspace (`/#laxii`).
2. A real generated result rendered in the thread with the new metadata
   disclosures ("Provider-managed text-to-image model", "requested
   1344×768 · model generated 1344×768").
3. **Clicked the result image** → the dialog `Image viewer` opened —
   **URL remained `http://localhost:3000/#laxii`** (no navigation).
4. Toolbar verified: Zoom out (correctly disabled at 100%), Zoom in, Fit to
   screen, Download image, Close image viewer; zoom-in raised the level
   above 100% and enabled zoom-out.
5. **Escape closed the viewer**; the URL stayed `/#laxii` and the workspace
   (result card + actions) was intact afterwards.
6. Screenshots captured: `scripts/m263-out/lightbox-fullscreen.png`
   (desktop, full-viewport viewer) and `scripts/m263-out/lightbox-mobile.png`
   (390×844 viewport).

## 4. Backend access preserved

- The asset route `/api/laxii/assets/[id]` is untouched: ownership-checked,
  used for `<img src>`, the Download actions, the viewer's blob fetch and
  all downstream edit flows.
- The job image route `/api/laxii/images/[id]` is untouched.
- Edit-further / remove-background / enhance / upscale flows consume the
  same asset IDs as before (no contract change).
