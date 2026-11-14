// M21 validation harness vite config — validator tooling only.
// Build root is ALWAYS the generated project directory this config is pointed
// at (the CLI passes it via --config + cwd). The generated deliverable never
// contains this file.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: process.env.M21_PROJECT_ROOT ?? process.cwd(),
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // generated projects run fully offline; nothing remote is allowed
    rollupOptions: { external: [] },
  },
})
