# Superconnect: Figma ↔ React Code Connect Generator

Superconnect is an AI-enhanced tool that writes your Figma Code Connect files for you. It takes these inputs:

- A Figma design system file
- A React (TypeScript) component repo

and produces:

- Figma Code Connect `.figma.tsx` files
- A `figma.config.json` configured for that run

It harnesses the power of your favorite coding agent (Claude Code or Codex) to handle fuzzy decisions that require judgment, and leans on small scripts for the deterministic, repeatable work.

- Agents (LLM prompts) do orientation, matching, and code generation.
- Scripts fetch Figma, scan React components, and build config.

---

# Quick Start

## Prerequisites

- Node.js ≥ 14
- A Figma file URL or file key
- An associated React/TS code repo you've cloned locally (e.g. `../chakra-ui`)
- A Figma access token (PAT)

## Setup

From this project’s root:

```bash
# Install dependencies
npm install

# Link the CLI globally (adds `superconnect` to your PATH)
npm link
```

Set your Figma token (in shell or `.env`):

```bash
export FIGMA_ACCESS_TOKEN=figd_your_token_here
# or in .env at repo root:
# FIGMA_ACCESS_TOKEN=figd_your_token_here
```

## Run

From this repo’s root:

```bash
superconnect \
  --figma-url "https://www.figma.com/design/...." \
  --repo-path ../chakra-ui \
  --figma-token "$FIGMA_ACCESS_TOKEN" \
  --agent-runner "codex exec --model gpt-5.1-codex-max"
```

# Configuration

You can configure the pipeline **via CLI flags** or **via a TOML file**, with CLI flags always winning if both are present.

## CLI flags (see `superconnect --help`)

```
  --figma-url <value>      Figma file URL or key (required)
  --repo-path <path>       Path to code repo (default: /Users/brandonharvey/src/chakra-ui)
  --figma-token <token>    Figma API token (or FIGMA_ACCESS_TOKEN env/.env)
  --agent-runner <cmd>     Command to run agent steps (reads prompt from stdin)
  --agent-stream           Stream full agent stdout/stderr to console (default: suppressed)
  --agent-filter <regex>   When suppressed, echo only lines matching this regex
  --agent-quiet            Suppress agent stdout in console (log file still written if configured)
  --artifacts <dir>        Artifacts root (default: /Users/brandonharvey/src/figma-code-connect-ai-poc/artifacts)
  --non-interactive        Auto-accept only certain matches (skip uncertain prompts)
  --force                  Re-run steps even if artifacts exist
  --dry-run                Print commands without executing them
  --skip-codegen           Skip codegen validation/agent handoff
```

## `superconnect.toml`

Most of these flags can be set in `superconnect.toml` at this repo’s root.

When both TOML and CLI flags are present:

- CLI flags win over `superconnect.toml`.
- `superconnect.toml` wins over hard-coded defaults (e.g., default `repo-path` and `artifacts` dir).

The one-shot runner (`superconnect` / `npm run pipeline:one-shot`) will:

- Read defaults from `superconnect.toml` (`[inputs]`, `[outputs]`, `[config]`).
- Run orientation → Figma fetch → React props extraction → matching → review → codegen → config builder.
- Reuse existing artifacts (manifest, match-candidates, mappings, codeconnect outputs, `figma.config.json`) unless you pass `--force` or change `--artifacts`.


# Using the Generated Files in Your Design System

Once the pipeline runs, you’ll have:

- `artifacts/codeconnect/*.figma.tsx`
- `artifacts/codeconnect/figma.config.json`

There are two basic integration paths: **copying these into your design system repo**, or **treating this repo as the “Code Connect project”** and pointing Figma at it.

## Copying into your design system repo

In your design system repo:

1. **Install Code Connect**

   ```bash
   npm install @figma/code-connect --save-dev
   ```

2. **Copy outputs**

   - Copy `artifacts/codeconnect/*.figma.tsx` into whatever folder you use for Code Connect files (e.g. `codeconnect/` or `src/codeconnect/` in your DS repo).
   - Copy `artifacts/codeconnect/figma.config.json` to the repo root or wherever your Code Connect tooling expects it.

3. **Wire into your build**

   - Ensure your bundler / test setup picks up `.figma.tsx` files (they’re just TSX).
   - If your DS has its own Code Connect config, merge or adjust the generated `figma.config.json` rather than overwriting blindly.

## Treating this repo as the Code Connect project

You can also leave the outputs here and point Figma directly at this repository:

1. Ensure `artifacts/codeconnect/figma.config.json` is present and correct.
2. Ensure the `.figma.tsx` files are where `figma.config.json` expects them (by default, in `artifacts/codeconnect/`).

Exactly how you expose this project to Figma (GitHub URL, local dev server, CI artifact, etc.) depends on your Code Connect setup, but the generated config + TSX files are all you need.

## What to look for in Figma to confirm it’s working

Once your Code Connect project is reachable from Figma:

- Open your design system file in Figma.
- Switch to Dev Mode.
- Select a component instance that should have a mapping.
- In the code panel / Code Connect plugin:
  - You should see the mapped React component name (e.g. `Button`).
  - The props panel should reflect enum mappings and booleans derived from the pipeline (e.g. `size`, `variant`, `disabled`).
  - Changing variant controls in Figma (e.g. toggling `size` or `variant`) should correspond to props that appear in your generated `.figma.tsx` file.

If you don’t see the expected mapping:

- Check that `mappings.json` actually includes that Figma component.
- Confirm there’s a `.figma.tsx` file for the mapped React component in `artifacts/codeconnect/`.
- Verify `figma.config.json` points at the correct Figma file key and includes the paths where `.figma.tsx` files live.
- If the React component name changed after you generated artifacts, rerun the pipeline.


# Pipeline overview

## Orientation (agent)
- Uses prompt file `prompts/orientation.md`.
- Inspects (for example) `../chakra-ui`.
- Discovers where React components live, recipes, import style, and tsconfig path.
- Writes `artifacts/codeconnect-manifest.json`.

## Figma fetch (script)
- Given a Figma file + token, discovers all the components and writes out a directory of JSON files to describe them.
- Calls `scripts/fetchComponents.js`.
- Writes JSON files to `artifacts/figma-components/`.

## React props extraction (script)
- Given a repo file path, and using the manifest file for guidance, discovers all the React components and writes out a directory of JSON files to describe them.
- Calls `scripts/code-component-scanner.js`.
- Writes JSON files to `artifacts/react-components/`.

## Matching (agent)
- Given the Figma + React JSON directories and the manifest, proposes Figma ↔ React component matches.
- Uses prompt file `prompts/matching.md`.
- Reads JSON from `artifacts/figma-components/` and `artifacts/react-components/`.
- Writes match candidates to `artifacts/match-candidates.jsonl`.

## Review (script)
- Reviews and approves the proposed matches, producing a clean mappings file.
- Calls `scripts/review-matches.js`.
- Reads `artifacts/match-candidates.jsonl`.
- Gets approval for each match from the user.
- Writes approved mappings to `artifacts/mappings.json`.

## Codegen (agent)
- Given mappings + JSONs + manifest, generates Code Connect `.figma.tsx` files.
- Uses prompt file `prompts/codegen.md`.
- Reads manifest, `artifacts/mappings.json`, and JSONs from `artifacts/figma-components/` and `artifacts/react-components/`.
- Writes `.figma.tsx` files to `artifacts/codeconnect/`.

## Config builder (script)
- Given Figma JSON + manifest + file key, generates a `figma.config.json` suitable for Code Connect.
- Calls `scripts/buildFigmaConfig.js`.
- Reads `artifacts/figma-components/` and `artifacts/codeconnect-manifest.json`.
- Writes `artifacts/codeconnect/figma.config.json`.

At the end you have:

- `artifacts/react-components/` — React-side component metadata (props, variants, hints)
- `artifacts/figma-components/` — Figma-side components and variants
- `artifacts/mappings.json` — Figma ↔ React mappings
- `artifacts/codeconnect/*.figma.tsx` — Code Connect files
- `artifacts/codeconnect/figma.config.json` — Config for those files


# Running Each Step A La Carte

You don’t have to run the whole pipeline end to end. Each stage can be run manually.

All commands below assume you’re in this repo root unless noted.

## Orientation (agent) → manifest

Goal: produce `artifacts/codeconnect-manifest.json`.

```bash
codex exec --cd . --model gpt-5.1-codex-max <<'EOF'
Use prompts/orientation.md.
Target repo: ../chakra-ui
Write manifest to artifacts/codeconnect-manifest.json.
EOF
```

Check:

- `artifacts/codeconnect-manifest.json` exists.
- It includes `componentRoot`, `importStyle`, `importTarget`, and `tsconfigPath`.

See: `docs/orientation-run.md`.

## Figma fetch → Figma JSON

```bash
npm run fetch:components -- \
  "https://www.figma.com/design/...." \
  --output ./artifacts/figma-components
```

Outputs: `artifacts/figma-components/*.json`.

See: `docs/pipeline-run.md`, `scripts/fetchComponents.js`.

## React props extraction → React JSON

Preferred: use the manifest so the scanner gets the right root and tsconfig.

```bash
node scripts/code-component-scanner.js \
  --manifest artifacts/codeconnect-manifest.json \
  --output artifacts/react-components \
  --overwrite --verbose
```

If you don’t want a manifest, you must provide explicit paths:

```bash
node scripts/code-component-scanner.js \
  --input path/to/components \
  --tsconfig path/to/tsconfig.json \
  --output components-props \
  --overwrite --verbose
```

Outputs: `artifacts/react-components/*.json` (or `components-props/*.json`).

See: `docs/extraction-run.md`, `scripts/code-component-scanner.js`.

## Matching (agent) → match candidates

```bash
codex exec --cd . --model gpt-5.1-codex-max <<'EOF'
Use prompts/matching.md.
Figma JSONs: artifacts/figma-components
React JSONs: artifacts/react-components
Manifest (context): artifacts/codeconnect-manifest.json
Produce match-candidates.jsonl in artifacts/.
EOF
```

Outputs: `artifacts/match-candidates.jsonl`.

See: `prompts/matching.md`.

## Review → mappings

```bash
node scripts/review-matches.js
```

- Reads `artifacts/match-candidates.jsonl`.
- Writes `artifacts/mappings.json`.

Supports non-interactive mode via the one-shot runner (`--non-interactive`).

See: `scripts/review-matches.js`.

## Codegen (agent) → Code Connect files

Run from `artifacts/` so the agent only sees generated files:

```bash
cd artifacts

codex exec --cd . --model gpt-5.1-codex-max <<'EOF'
Use ../prompts/codegen.md.
Manifest: codeconnect-manifest.json
Mappings: mappings.json
React JSONs: react-components
Figma JSONs: figma-components
Output dir: codeconnect/
EOF
```

Outputs: `artifacts/codeconnect/*.figma.tsx`.

See: `prompts/codegen.md`.

## Config builder → figma.config.json

```bash
node scripts/buildFigmaConfig.js \
  --input artifacts/figma-components \
  --manifest artifacts/codeconnect-manifest.json \
  --file-key "<FIGMA_URL_OR_KEY>" \
  --output file \
  --output-file artifacts/codeconnect/figma.config.json
```

Outputs: `artifacts/codeconnect/figma.config.json`.

See: `scripts/buildFigmaConfig.js`.


# Development Notes

Helpful npm scripts:

```bash
# Check script syntax
npm run dev:check

# One-shot pipeline
npm run pipeline:one-shot -- --figma-url ... --repo-path ... --figma-token ...

# Figma-only
npm run fetch:components -- "<FIGMA_URL_OR_KEY>" --output ./artifacts/figma-components

# React-only (scanner)
npm run extract:props
```

For more details, see:

- `docs/pipeline-run.md` — manual golden-path commands.
- `scripts/README.md` — script-by-script details.
