# Matching Run Guide

Purpose: run the matching agent to produce high-confidence and uncertain mappings between Figma and React components.

Inputs:
- Figma YAML directory (e.g., `artifacts/figma-components`).
- React YAML directory (e.g., `artifacts/react-components`).
- Manifest JSON (required; e.g., `artifacts/codeconnect-manifest.json` from orientation).
- Optional: target component list to focus on (reduce scope).

Agent instructions:
- Use `prompts/matching.md`.
- Read componentName fields from both directories.
- Apply the described heuristics; do not force matches when uncertain.
- Write output as JSONL to `artifacts/match-candidates.jsonl` (one JSON object per line):
  - Certain line: `{"type":"certain","figmaName":"Avatar","reactName":"Avatar","reason":"exact normalized match"}`
  - Uncertain line: `{"type":"uncertain","figmaName":"Tabs.Trigger","candidates":[{"reactName":"TabsTrigger","score":0.22,"reason":"tokens tabs+trigger match"}]}`

Manual invocation (example with codex exec):
```
codex exec --cd . --model gpt-5.1-codex <<'EOF'
Use prompts/matching.md.
Figma YAMLs: artifacts/figma-components
React YAMLs: artifacts/react-components
Manifest (context): artifacts/codeconnect-manifest.json
Produce match-candidates.jsonl in artifacts/.
EOF
```
(Ensure EOF is unindented; adjust tool invocation to your agent runner.)

Validation:
- `artifacts/match-candidates.jsonl` exists; each line is valid JSON with `type` set to `certain` or `uncertain`.
- Spot-check: obvious matches (e.g., Avatar) appear as `type:certain`; ambiguous ones as `type:uncertain` with a few candidates.
