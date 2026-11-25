import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // AUTO DIRECTOR constrained-host build (2026-11-20): BEAN_BUILD_NO_STANDALONE=1
  // compiles the full production build WITHOUT the standalone trace+package
  // step. Measured on the ₹0 sandbox: the standalone trace peaks ~5 GB and
  // hits ENOSPC when the recovery bundles and owner deliverables share the
  // same 10 GB disk. The default (standalone) is unchanged for normal hosts;
  // this flag only relaxes PACKAGING, never compilation or validation.
  output: process.env.BEAN_BUILD_NO_STANDALONE ? undefined : "standalone",
  // AUTO DIRECTOR build hardening (2026-11-20): the standalone server bundle
  // must never trace working-tree artifacts — recovery material, test
  // fixtures, scripts and owner deliverables are not runtime dependencies,
  // and tracing them measured ENOSPC build failures on the ₹0 host.
  outputFileTracingExcludes: {
    "/**/*": [
      "./scripts/**",
      "./tests/**",
      "./recovery/**",
      "./docs/**",
      "./download/**",
      "./upload/**",
      "./storage/**",
    ],
    "*": [
      "./scripts/**",
      "./tests/**",
      "./recovery/**",
      "./docs/**",
      "./download/**",
      "./upload/**",
      "./storage/**",
    ],
  },
  // WORKSPACE ROOT SCOPING (2026-11-18): this clone lives inside a parent
  // directory that has its own bun.lock (the outer workspace). Without an
  // explicit root, Turbopack selects the parent directory and walks the
  // entire outer tree (including ~1.7 GB of local recovery bundles), which
  // OOM-kills the 4 GB build sandbox (exit 137, measured twice). Scoping the
  // root to THIS project directory is the documented fix.
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // pdf-parse embeds pdfjs-dist, which resolves its worker module relative to
  // the real node_modules tree. Bundling it breaks that resolution ("Cannot
  // find module pdf.worker.mjs"), so it must stay an external server package.
  // GANGZII audio engine (M27): the local TTS stack must stay an external
  // server package chain — onnxruntime-node loads native .node binaries,
  // phonemizer loads its espeak-ng WASM + data by relative path, and
  // kokoro-js reads its bundled voices/*.bin from its package directory.
  // Bundling any of them breaks those path resolutions.
  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    // 2026-11-18: the browser AI runtimes are pure client/worker packages
    // (WebGPU/WASM). Keeping them external on the SERVER build avoids
    // double-bundling the full runtimes into the SSR graph — they are only
    // ever dynamically imported inside 'use client' modules, where the
    // client/worker bundles handle them.
    "@mlc-ai/web-llm",
    "@huggingface/transformers",
    "onnxruntime-web",
    // M27: local TTS stack (native .node binaries + WASM + voice .bin paths)
    "kokoro-js",
    "phonemizer",
    "onnxruntime-node",
    "sharp",
  ],
  // Frontend Intelligence Toolkit: the CODE GIFTZ generation route reads
  // (a) the curated React Bits kit sources (src/components/giftz-kit) to emit
  // them into generated React projects, and (b) the pinned minified UMD
  // builds (gsap/three/vanta) from node_modules to vendor them into generated
  // static projects. Standalone output only copies statically-imported files,
  // so these are traced explicitly — identical relative paths in dev, test
  // and production.
  outputFileTracingIncludes: {
    "/api/code-giftz/**": [
      "./src/components/giftz-kit/**/*",
      // GSAP core + the full free plugin set (ScrollTrigger, SplitText,
      // MorphSVGPlugin, MotionPathPlugin, Flip, Draggable, Observer,
      // CustomEase, DrawSVGPlugin, ScrambleTextPlugin).
      "./node_modules/gsap/dist/*.min.js",
      "./node_modules/three/build/three.min.js",
      "./node_modules/vanta/dist/*.min.js",
      // p5.js 0.6.1, vendored INSIDE the vanta package — the runtime for the
      // p5-based Vanta effects (trunk, topology).
      "./node_modules/vanta/vendor/p5.min.js",
    ],
    // M40 (2026-11-25): runtime-loaded package assets the standalone trace
    // cannot see, measured on the acceptance host —
    //  - tesseract.js spawns its worker through worker_threads from the
    //    PACKAGE directory at OCR time; that worker script requires
    //    regenerator-runtime at runtime, outside any bundle. Without the
    //    full package + runtime the standalone deployment HANGS on the
    //    first image upload (measured: createWorker never resolves).
    //  - kokoro-js reads its bundled voices/*.bin from the package dir
    //    (M27 note above) — the trace missed them (measured ENOENT).
    //  - phonemizer loads its espeak-ng WASM + data by relative path and
    //    must be present whole beside the kokoro-js chain.
    "/api/riishe/**": [
      "./node_modules/tesseract.js/**/*",
      "./node_modules/regenerator-runtime/**/*",
    ],
    "/api/gangzii/**": [
      "./node_modules/kokoro-js/**/*",
      "./node_modules/phonemizer/**/*",
    ],
  },
  // W6 security review (SEC-W6-02): app-level security headers.
  // DELIBERATELY EXCLUDED: X-Frame-Options / CSP frame-ancestors — this
  // product is a workspace PREVIEW app: the platform's preview panel embeds
  // the site cross-origin by design, and a framing header would break the
  // whole-website preview (the exact defect this workspace keeps hitting).
  // Origin policy (src/lib/api/origin.ts) + SameSite=None; Secure session
  // cookies remain the cross-site defenses. HSTS belongs to the TLS-terminating
  // ingress (platform boundary) and is documented in the W6 security report.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // GANGZII AUDIO WIRING (2026-11-18): live voice records the user's
          // microphone IN-BROWSER (MediaRecorder) for real transcription —
          // server ASR or, when enabled, the on-device Whisper lane where the
          // audio never leaves the device. Same-origin mic access only
          // (microphone=(self)); cross-origin frames are still denied, and
          // geolocation/camera remain fully denied.
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
