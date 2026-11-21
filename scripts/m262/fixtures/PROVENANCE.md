# M26.2 acceptance fixtures — provenance and licenses

Every fixture is a REAL photograph with a recorded, verifiable source and a
license that permits free use (Pexels License: free for commercial use, no
attribution required; modification permitted). Hashes pin the exact artifact.

| File | Used by | Source (exact, fetched 2026-11-18) | License | SHA-256 (of the committed file) |
|---|---|---|---|---|
| `portrait.jpg` (800×533) | LAXII conversational-edit step (crop of the original) | https://images.pexels.com/photos/415829/pexels-photo-415829.jpeg (Pexels photo 415829) | Pexels License | see `sha256sum` below |
| `portrait-studio.jpg` (800×1200) | LAXII background-removal step (transparent-PNG claim) | https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg (Pexels photo 774909) | Pexels License | see `sha256sum` below |
| `scene.jpg` (800×600) | LAXII masked object removal + JAZMII image-to-video | https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg (Pexels photo 1108099) — verified BYTE-IDENTICAL to the source artifact | Pexels License | see `sha256sum` below |

Notes:
- Model weights are NEVER committed (they live under `storage/models/`,
  gitignored, SHA-256-pinned in `src/lib/media/local-models.ts`).
- The synthetic gradient used by the honest-unsupported step is generated in
  the acceptance script itself (`sharp` SVG), not a fixture file.
