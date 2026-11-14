import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  // Third-party React Bits implementations (src/components/giftz-kit) are
  // vendored VERBATIM with attribution headers — rewriting upstream code to
  // satisfy these rules would corrupt the supply chain (exact sources are
  // pinned in docs/CODE-GIFTZ-FRONTEND-INTELLIGENCE-AUDIT.md and the
  // expansion report). The repo already declines these rules globally (see
  // above); the rule ids changed in eslint-plugin-react-hooks v6, so they
  // are re-disabled here by scope. The 2026-11 expansion vendored the full
  // compatible free collection, which additionally trips rules-of-hooks
  // (upstream helper functions calling React 19 `use`), immutability and
  // preserve-manual-memoization (compiler diagnostics under their v6 rule
  // ids), and carries upstream `eslint-disable` directives that are no-ops
  // under this config — suppressed via reportUnusedDisableDirectives.
  files: ["src/components/giftz-kit/**"],
  linterOptions: { reportUnusedDisableDirectives: "off" },
  rules: {
    "react-hooks/refs": "off",
    "react-hooks/set-state-in-effect": "off",
    "react-hooks/purity": "off",
    "react-hooks/rules-of-hooks": "off",
    "react-hooks/immutability": "off",
    "react-hooks/preserve-manual-memoization": "off",
    "react-compiler/react-compiler": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills"]
}];

export default eslintConfig;
