# One-Shot Pipeline Run Guide

Run the full golden-path pipeline with a single command.

## Quick start (Chakra demo)

```bash
npm run pipeline:one-shot -- \
  --figma-url "https://www.figma.com/design/mgzCV3zD3iWpctEI6UoUhB/Chakra-UI?node-id=12-184&m=dev" \
  --repo-path ../chakra-ui \
  --figma-token "$FIGMA_ACCESS_TOKEN" \
  --agent-runner "codex exec --cd . --model gpt-5.1-codex"
```

What happens:
- Writes a manifest using Chakra defaults if `artifacts/codeconnect-manifest.json` is missing.
- Runs Figma fetch → React props extraction → matching agent → review → codegen validation + agent → config builder.
- Artifacts land under `artifacts/` (`figma-components/`, `react-components/`, `match-candidates.jsonl`, `mappings.json`, `codeconnect/`).

## Flags

- `--figma-url <url|fileKey>`: required.
- `--repo-path <path>`: required; Chakra defaults kick in when the path includes `chakra-ui`.
- `--figma-token <token>`: required unless `FIGMA_ACCESS_TOKEN` or `.env` provides it.
- `--agent-runner <cmd>`: optional; command that reads the agent prompt from stdin (e.g., `codex exec --cd . --model gpt-5.1-codex`). If omitted, agent steps print instructions and the pipeline stops until addressed.
- `--non-interactive`: auto-accepts only certain matches (`review-matches` receives `s` to skip uncertain).
- `--dry-run`: print planned commands without executing them.
- `--skip-codegen`: stop after mapping; useful when you only want config and mapping validation.
- `--format <yaml|json|both>`: format for Figma fetch + React extraction (default: `yaml`).

## Agent steps

Three steps rely on an agent: orientation, matching, and codegen. Supplying `--agent-runner` automates these by piping the prompt payload via stdin. Without it, the script tells you exactly what to run and exits early.

## Reruns and artifacts

- Existing artifacts are reused when present (manifest, match-candidates, mappings). Delete them or change `--artifacts` if you want a clean run.
- `--non-interactive` makes review non-blocking by skipping uncertain matches. Omit it if you want to review interactively.

## Validation

After a successful run you should see:
- `artifacts/figma-components/` and `artifacts/react-components/` populated
- `artifacts/match-candidates.jsonl` and `artifacts/mappings.json`
- `artifacts/codeconnect/` (after codegen agent) and `figma.config.json` at repo root
