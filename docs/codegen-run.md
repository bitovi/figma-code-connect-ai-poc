# CodeGen Run Guide

Purpose: generate Code Connect `.figma.tsx` files (or, for now, validate inputs with the stub) using manifest, mappings, and the YAML artifacts.

Inputs:
- Manifest: `artifacts/codeconnect-manifest.json`
- Mappings: `artifacts/mappings.json`
- React YAMLs: `artifacts/react-components`
- Figma YAMLs: `artifacts/figma-components`

Step 1: validate inputs with the stub
```
node scripts/generateCodeConnect.js \
  --manifest artifacts/codeconnect-manifest.json \
  --mappings artifacts/mappings.json \
  --figma artifacts/figma-components \
  --react artifacts/react-components \
  --out artifacts/codeconnect
```
Expected: a summary of planned `.figma.tsx` files and confirmation of import strategy; no files are written.

Step 2: ask an agent to generate files (manual example)
```
codex exec --cd artifacts --model gpt-5.1-codex <<'EOF'
Use ../prompts/codegen.md.
Manifest: codeconnect-manifest.json
Mappings: mappings.json
React YAMLs: react-components
Figma YAMLs: figma-components
Output dir: codeconnect/
EOF
```
(Running with `--cd artifacts` keeps the agent scoped to artifacts only. Ensure EOF is unindented; adjust invocation for your runner.)

Validation after generation:
- `artifacts/codeconnect/` contains one `.figma.tsx` per approved mapping.
- Each file imports per manifest rules and calls `connect(...)` with sensible `figma.*` prop mappings.
