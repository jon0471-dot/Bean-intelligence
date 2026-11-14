#!/usr/bin/env bash
# M21 build gate — per-project: install the GENERATED package.json pins
# verbatim, then run tsc + eslint + vite production build with the harness
# tooling. Validator tooling only; nothing here ships in a deliverable.
set -uo pipefail
KEY="$1"           # a|b|c
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"          # repo root
M21="$ROOT/validation/m21"
PROJ="$M21/projects/project-a-landing"
case "$KEY" in
  a) PROJ="$M21/projects/project-a-landing" ;;
  b) PROJ="$M21/projects/project-b-dashboard" ;;
  c) PROJ="$M21/projects/project-c-portfolio" ;;
  *) echo "usage: build.sh <a|b|c>" >&2; exit 2 ;;
esac
HARNESS="$M21/harness"
LOG="$M21/reports/$KEY-build.log"
cd "$PROJ" || exit 2

echo "== M21 build gate: $PROJ ==" | tee "$LOG"

# 1. dependencies: install EXACTLY what the generated package.json declares
echo "-- npm install (generated dependency pins)" | tee -a "$LOG"
npm install --no-audit --no-fund --loglevel=error >>"$LOG" 2>&1 || { echo "FAIL npm install" | tee -a "$LOG"; exit 1; }
# Type companions for typed checking of generated code (validator tooling):
# installed WITHOUT saving so the generated package.json stays verbatim.
if [ -d node_modules/three ]; then
  npm install --no-save --no-audit --no-fund --loglevel=error @types/three@0.134.0 >>"$LOG" 2>&1 \
    || { echo "FAIL @types/three install" | tee -a "$LOG"; exit 1; }
fi
node -e "const p=require('./package.json'); console.log('generated deps:', JSON.stringify(p.dependencies))" | tee -a "$LOG"

# 2. harness glue (validator tooling, kept out of the deliverable): tsconfig,
#    ambient css module declarations. Written fresh every run.
cat > tsconfig.harness.json <<'EOF'
{
  "extends": "../../harness/tsconfig.base.json",
  "include": ["index.tsx", "App.tsx", "components/**/*.tsx", "components/**/*.ts", "lib/**/*.ts", "lib/**/*.tsx", "types/**/*.d.ts", "pages/**/*.tsx", "data/**/*.ts", "harness-env.d.ts", "main.tsx"]
}
EOF
cat > harness-env.d.ts <<'EOF'
// M21 harness: ambient declarations so tsc accepts the project's CSS imports.
declare module '*.css'
EOF

# 3. TypeScript
echo "-- tsc --noEmit" | tee -a "$LOG"
"$HARNESS/node_modules/typescript/bin/tsc" -p tsconfig.harness.json >>"$LOG" 2>&1 \
  || { echo "FAIL tsc" | tee -a "$LOG"; grep -E "error TS" "$LOG" | head -20; exit 1; }
echo "tsc: 0 errors" | tee -a "$LOG"

# 4. ESLint — model-generated app files only (kit/ is engine-managed)
echo "-- eslint (model files)" | tee -a "$LOG"
"$HARNESS/node_modules/eslint/bin/eslint.js" . \
  --config "$HARNESS/eslint.config.mjs" >>"$LOG" 2>&1 \
  || { echo "FAIL eslint" | tee -a "$LOG"; tail -30 "$LOG"; exit 1; }
echo "eslint: 0 errors 0 warnings" | tee -a "$LOG"

# 5. Production build
echo "-- vite build" | tee -a "$LOG"
M21_PROJECT_ROOT="$PROJ" "$HARNESS/node_modules/vite/bin/vite.js" build \
  --config "$HARNESS/vite.config.mjs" --outDir dist --emptyOutDir >>"$LOG" 2>&1 \
  || { echo "FAIL vite build" | tee -a "$LOG"; tail -30 "$LOG"; exit 1; }
ls dist/assets | tee -a "$LOG"
echo "BUILD PASS" | tee -a "$LOG"
