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
};

export default nextConfig;
