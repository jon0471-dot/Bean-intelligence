import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // pdf-parse embeds pdfjs-dist, which resolves its worker module relative to
  // the real node_modules tree. Bundling it breaks that resolution ("Cannot
  // find module pdf.worker.mjs"), so it must stay an external server package.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
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
      "./node_modules/gsap/dist/gsap.min.js",
      "./node_modules/gsap/dist/ScrollTrigger.min.js",
      "./node_modules/three/build/three.min.js",
      "./node_modules/vanta/dist/*.min.js",
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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
