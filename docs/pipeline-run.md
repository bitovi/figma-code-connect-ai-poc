# Pipeline Run Guide (Manual)

Goal: run the full (manual) pipeline end-to-end to produce Code Connect outputs. Each step consumes artifacts from the previous step. When ready, an orchestrator can script these commands.

Prereqs:
- Figma access token in `.env` (`FIGMA_ACCESS_TOKEN=...`).
- Figma file key or URL.
- Sibling Chakra repo present at `../chakra-ui` (or adjust paths in manifest/orientation).

Steps:

1) Orientation (produce manifest)
- Purpose: discover component root/import strategy; emits `artifacts/codeconnect-manifest.json`.
- Run (agent example):
```
codex exec --cd . --model gpt-5.1-codex <<'EOF'
Use prompts/orientation.md.
Write manifest to artifacts/codeconnect-manifest.json.
EOF
```
Outputs: `artifacts/codeconnect-manifest.json`.

2) Figma fetch (variants)
- Purpose: pull Figma component variants into YAML/JSON.
- Run:
```
npm run fetch:components -- "<FIGMA_URL_OR_KEY>" --format yaml --output ./artifacts/figma-components
```
Outputs: `artifacts/figma-components/*.yaml` (plus JSON if requested).

3) React props extraction
- Purpose: extract component props/variants from the React codebase.
- Run:
```
node scripts/extractComponentProps.js \
  --manifest artifacts/codeconnect-manifest.json \
  --output artifacts/react-components \
  --overwrite --verbose
```
Outputs: `artifacts/react-components/*.yaml`.

4) Matching
- Purpose: propose Figma→React matches.
- Run (agent):
```
codex exec --cd . --model gpt-5.1-codex <<'EOF'
Use prompts/matching.md.
Figma YAMLs: artifacts/figma-components
React YAMLs: artifacts/react-components
Manifest (context): artifacts/codeconnect-manifest.json
Produce match-candidates.jsonl in artifacts/.
EOF
```
Outputs: `artifacts/match-candidates.jsonl`.

5) Review matches
- Purpose: approve uncertain matches; combine with certain.
- Run:
```
node scripts/review-matches.js
```
Outputs: `artifacts/mappings.json`.

6) Codegen
- Purpose: generate Code Connect `.figma.tsx` files from mappings + YAMLs.
- Run (agent from artifacts dir to stay scoped):
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
Outputs: `artifacts/codeconnect/*.figma.tsx`.

7) Config builder
- Purpose: produce `figma.config.json` with URL substitutions and import/path defaults.
- Run:
```
node scripts/buildFigmaConfig.js \
  --input artifacts/figma-components \
  --manifest artifacts/codeconnect-manifest.json \
  --file-key <FIGMA_URL_OR_KEY> \
  --output file
```
Outputs: `figma.config.json` (repo root).

Notes:
- Manifest is the single source of truth for component root/import style/paths; downstream steps read it, CLI flags can override.
- Artifacts live under `artifacts/` (gitignored). Ensure the directory exists before running steps that write there.
- Models: examples use `--model gpt-5.1-codex`; adjust per availability. Keep agent working dir to artifacts for codegen to limit context. 
