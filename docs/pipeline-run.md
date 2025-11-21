# Pipeline Run Guide (Manual)

Manual, step-by-step run of the full pipeline. Prefer the single-command runner? See `docs/one-shot-run.md`. Each step consumes artifacts from the previous one (JSON-only pipeline).

## Prerequisites
- Figma token in `.env` (`FIGMA_ACCESS_TOKEN=...`).
- Figma file key or URL.
- Chakra repo at `../chakra-ui` (or adjust paths/manifest).

## Steps

### 1) Orientation (agent) → manifest
Purpose: discover component root/import strategy; writes `artifacts/codeconnect-manifest.json`.
```
codex exec --cd . --model gpt-5.1-codex-max <<'EOF'
Use prompts/orientation.md.
Target repo: ../chakra-ui
Write manifest to artifacts/codeconnect-manifest.json.
EOF
```
Output: `artifacts/codeconnect-manifest.json`.

### 2) Figma fetch → figma JSONs
Purpose: pull Figma component variants into JSON.
```
npm run fetch:components -- "https://www.figma.com/design/mgzCV3zD3iWpctEI6UoUhB/Chakra-UI?node-id=12-184&m=dev" --output ./artifacts/figma-components
```
Output: `artifacts/figma-components/*.json`.

### 3) React props extraction → react JSONs
Purpose: extract component props/variants from the React codebase.
```
node scripts/extractComponentProps.js \
  --manifest artifacts/codeconnect-manifest.json \
  --output artifacts/react-components \
  --overwrite --verbose
```
Output: `artifacts/react-components/*.json`.

### 4) Matching (agent) → match candidates
Purpose: propose Figma→React matches.
```
codex exec --cd . --model gpt-5.1-codex-max <<'EOF'
Use prompts/matching.md.
Figma JSONs: artifacts/figma-components
React JSONs: artifacts/react-components
Manifest (context): artifacts/codeconnect-manifest.json
Produce match-candidates.jsonl in artifacts/.
EOF
```
Output: `artifacts/match-candidates.jsonl`.

### 5) Review matches → mappings
Purpose: approve uncertain matches; combine with certain.
```
node scripts/review-matches.js
```
Output: `artifacts/mappings.json`.

### 6) Codegen (agent, run from artifacts/) → Code Connect files
Purpose: generate `.figma.tsx` files from mappings + JSONs.
```
codex exec --cd artifacts --model gpt-5.1-codex-max <<'EOF'
Use ../prompts/codegen.md.
Manifest: codeconnect-manifest.json
Mappings: mappings.json
React JSONs: react-components
Figma JSONs: figma-components
Output dir: codeconnect/
EOF
```
Output: `artifacts/codeconnect/*.figma.tsx`.

### 7) Config builder → figma.config.json
Purpose: produce `artifacts/codeconnect/figma.config.json` with URL substitutions and import/path defaults.
```
node scripts/buildFigmaConfig.js \
  --input artifacts/figma-components \
  --manifest artifacts/codeconnect-manifest.json \
  --file-key <FIGMA_URL_OR_KEY> \
  --output file \
  --output-file artifacts/codeconnect/figma.config.json
```
Output: `artifacts/codeconnect/figma.config.json`.

## Notes
- Manifest is the source of truth for component root/import style/paths; downstream steps read it (CLI flags can override).
- Artifacts live under `artifacts/` (gitignored). Ensure the directory exists before writing.
- Models: examples use `--model gpt-5.1-codex-max`; adjust per availability. Keep codegen cwd to `artifacts/` to stay scoped.
