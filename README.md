# Figma Code Connect - AI POC

A minimal pipeline to go from a Figma file + a React component repo to Code Connect outputs. Artifacts live under `artifacts/` (gitignored).

## One-shot pipeline (beta)

Run the whole pipeline with three inputs (Figma URL/key, repo path, and token):

```bash
npm run pipeline:one-shot -- \
  --figma-url "https://www.figma.com/design/mgzCV3zD3iWpctEI6UoUhB/Chakra-UI?node-id=12-184&m=dev" \
  --repo-path ../chakra-ui \
  --figma-token "$FIGMA_ACCESS_TOKEN" \
  --agent-runner "codex exec --model gpt-5.1-codex-max"
```
Or use the CLI alias: `npx superconnect -- --figma-token "$FIGMA_ACCESS_TOKEN"` (reads defaults from `superconnect.toml`).

### Install/link the CLI
Use the local checkout without installing:
```
npx superconnect -- --figma-token "$FIGMA_ACCESS_TOKEN"
```

Or install it globally from this repo:
```
npm install
npm link   # creates the superconnect binary
superconnect -- --figma-token "$FIGMA_ACCESS_TOKEN"
```

### Config via `superconnect.toml`
Optional defaults live in `superconnect.toml` at the repo root:
```toml
[inputs]
figma_url    = "https://www.figma.com/design/..."
component_repo = "../your-repo"

[outputs]
output_dir = "artifacts"
agents_log_directory = "artifacts/agent-logs"

[config]
agent_run_command = "codex exec --model gpt-5.1-codex-max"
```
- CLI flags override values from the file.
- Agent steps run with cwd set automatically: orientation/matching from the repo, codegen from `artifacts/`.
- Logs are written live if `agents_log_directory` is set; console output is suppressed by default (use `--agent-stream` or `--agent-filter` to surface lines).

Notes:
- Defaults can come from `superconnect.toml` (figma url/key, repo, artifacts dir, agent log dir, agent runner).
- Chakra defaults are auto-applied when `--repo-path` includes `chakra-ui` (writes `artifacts/codeconnect-manifest.json` if missing).
- Agent steps (orientation, matching, codegen) run via `--agent-runner` if provided; otherwise the script will prompt you to run them manually. Agent output is suppressed by default but streams to the log if `agents_log_directory` is set in `superconnect.toml`; use `--agent-stream` or `--agent-filter` to surface console output.
- Existing artifacts are reused by default; add `--force` to re-run steps and regenerate outputs.
- Helpful flags: `--dry-run` (plan only), `--non-interactive` (auto-accept certain matches), `--skip-codegen`.
- See `docs/one-shot-run.md` for details.

## Overview of the pipeline

1) **Orientation (agent)** — Inspect the code repo, decide component root/import strategy, write `artifacts/codeconnect-manifest.json`. Prompt: `prompts/orientation.md`.
2) **Figma fetch** — Download component variants to JSON: `npm run fetch:components -- "<FIGMA_URL_OR_KEY>" --output ./artifacts/figma-components`.
3) **React props extraction** — Extract component metadata to JSON:  
```
node scripts/extractComponentProps.js \
  --manifest artifacts/codeconnect-manifest.json \
  --output artifacts/react-components \
  --overwrite --verbose
```
4) **Matching (agent)** — Propose Figma→React matches: `prompts/matching.md`, write `artifacts/match-candidates.jsonl`.
5) **Review matches** — Approve uncertain matches: `node scripts/review-matches.js` → `artifacts/mappings.json`.
6) **Codegen (agent)** — Generate `.figma.tsx` files from mappings + JSONs: run agent from `artifacts/` with `prompts/codegen.md`; outputs `artifacts/codeconnect/*.figma.tsx`.
7) **Config builder** — Produce `artifacts/codeconnect/figma.config.json` (uses manifest for import/paths):  
```
node scripts/buildFigmaConfig.js \
  --input artifacts/figma-components \
  --manifest artifacts/codeconnect-manifest.json \
  --file-key <FIGMA_URL_OR_KEY> \
  --output file \
  --output-file artifacts/codeconnect/figma.config.json
```

See `docs/pipeline-run.md` for the full golden-path commands.

## Key scripts
- `scripts/fetchComponents.js` — Figma variants → JSON (`npm run fetch:components`).
- `scripts/extractComponentProps.js` — React component metadata → JSON.
- `scripts/review-matches.js` — CLI to approve uncertain matches.
- `scripts/generateCodeConnect.js` — Stub validator (plans codegen outputs).
- `scripts/buildFigmaConfig.js` — Writes `figma.config.json` (under `artifacts/codeconnect/` by default) using manifest defaults (CLI flags override).

## Artifacts layout
- `artifacts/codeconnect-manifest.json` — Component root/import strategy discovered in orientation.
- `artifacts/figma-components/` — Figma variant JSON files.
- `artifacts/react-components/` — React component JSON files.
- `artifacts/match-candidates.jsonl` — Suggested matches (certain + uncertain).
- `artifacts/mappings.json` — Approved matches.
- `artifacts/codeconnect/` — Generated `.figma.tsx` files and `figma.config.json` (+ README).

## Prereqs
- Node.js (>=14)
- Figma token in `.env`: `FIGMA_ACCESS_TOKEN=...`
- Access to the target code repo (e.g., sibling `../chakra-ui`) and a Figma file URL/key.

## References
- Run guides: `docs/pipeline-run.md`, `docs/orientation-run.md`, `docs/extraction-run.md`, `docs/matching-run.md`, `docs/review-run.md`, `docs/codegen-run.md`, `docs/config-run.md`.
- Prompts for agents: `prompts/orientation.md`, `prompts/matching.md`, `prompts/codegen.md`.
