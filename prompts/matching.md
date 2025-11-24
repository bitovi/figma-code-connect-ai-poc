# Matching Agent Prompt

Goal: Map Figma components to React components using JSON artifacts and manifest. Produce high-confidence matches and a list of uncertain cases with candidate suggestions. Stay scoped to the provided component list (from `component-scope.json`) so we only map what Figma actually uses.

Inputs:
- Figma variants directory (JSON from fetchComponents).
- React components directory (JSON from code-component-scanner).
- Manifest JSON for import strategy and component root context (required).
- Component scope JSON (from orientation) with `reactComponents` + per-Figma candidates.

Heuristics:
- Normalize names: lower, strip non-alphanumerics, split on dots/spaces/underscores, singularize where obvious.
- Strong signals: exact normalized match; same tokens in different order (e.g., Timeline.Title -> TimelineTitle); dot-separated Figma parts matching compound React names.
- Subcomponent mapping: for Figma names containing dots (“Tabs.Trigger”), look for React names sharing the parent token (“Tabs”) and the child token (“Trigger/Item/Content/etc.”).
- Avoid weak matches: high Levenshtein distance without token overlap should be uncertain.
- Skip components with no plausible React candidate (do not force a match).

Output: JSONL file (one object per line) at `artifacts/match-candidates.jsonl`:
```json
{"type":"certain","figmaName":"Avatar","reactName":"Avatar","reason":"exact normalized match"}
{"type":"uncertain","figmaName":"Tabs.Trigger","candidates":[{"reactName":"TabsTrigger","score":0.22,"reason":"tokens tabs+trigger match"},{"reactName":"MenuTrigger","score":0.35,"reason":"trigger token overlap"}]}
```
- `type` is `certain` or `uncertain`.
- For `uncertain`, include up to 5 candidates, each with `reactName`, `score` (lower is better), and `reason`.

Agent tasks:
1) Load manifest for context (import alias/target and roots).
2) Load component scope JSON; use `reactComponents` to filter React JSON files and `fromFigma` to understand naming patterns (parents/children).
3) Read component names from Figma JSON (`componentName`), but only match those listed in the scope.
4) Read component names from React JSON (`componentName`) and collect optional path info; ignore components outside the scope unless clearly a parent/child that improves a match.
5) Apply heuristics to produce `certain` and `uncertain` lists.
6) Write one JSON object per line to `artifacts/match-candidates.jsonl` (or specified path) following the schema above.
7) Emit a brief summary: counts, examples of certain and uncertain.

Constraints:
- Do not invent matches; if unsure, put in `uncertain` with candidates or skip.
- Limit to scoped components; you may note skipped/out-of-scope items briefly.
