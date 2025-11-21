# Orientation Run Guide

Purpose: run the orientation agent to produce a manifest file (JSON) describing component roots/import strategy.

Steps (manual agent invocation):
1) Ensure repo is available on disk.
2) Provide the agent with `prompts/orientation.md`.
3) Ask the agent to inspect the repo using allowed tools (`rg`, `ast-grep`, `ls`, `cat`, small `node` scripts).
4) Agent writes the manifest JSON to `artifacts/codeconnect-manifest.json`. Create `artifacts/` if it does not exist.
5) Agent outputs a short summary of findings (componentRoot, recipesPath if any, importStyle/Target, tsconfigPaths if any).

Example (codex exec):
```
codex exec --cd . --model gpt-5.1-codex <<'EOF'
Use prompts/orientation.md.
Write manifest to artifacts/codeconnect-manifest.json.
EOF
```
(Ensure EOF is unindented; adjust invocation to your agent runner.)

Validation checklist:
- `artifacts/codeconnect-manifest.json` exists and parses as JSON.
- `componentRoot` points to a real directory with TS/TSX components.
- `importStyle` is one of package/alias/relative; `importTarget` is set accordingly.
- `tsconfigPaths` present if aliases detected; empty/omitted otherwise.
- Summary notes any ambiguities or missing recipes.
