# Review Run Guide

Purpose: review uncertain matches and produce approved mappings.

Inputs:
- JSONL from matching: `artifacts/match-candidates.jsonl`

Output:
- Approved mappings: `artifacts/mappings.json` (array of `{figmaName, reactName, source}`)

How to run:
```
node scripts/review-matches.js
```

Behavior:
- Auto-approves all `type: certain` entries with `source: "certain"`.
- Prompts for each `type: uncertain` entry, showing candidates; choose a number, press Enter to skip, or enter `s` to skip all remaining.
- This step links Figma components to code components so CodeConnect files can be generated; skipped items remain unmapped.
- Writes the combined mappings to `artifacts/mappings.json`.

Validation:
- Output file exists and is valid JSON.
- Contains approved pairs with `source` set to `certain` or `review`.
