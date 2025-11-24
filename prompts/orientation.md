# Orientation Agent Prompt

You are given a codebase via your current working directory. Do NOT read any files outside this repo. Inspect only this repo to propose:
- A manifest that downstream tools will use.
- A component scope focused on the provided Figma components (listed below).

You cannot write files; emit the JSON objects to stdout using the delimiters. Assume the only context you have is the repo and the Figma component list embedded in this prompt.

## What to discover
- `componentRoot`: directory containing the React components to scan.
- `tsconfigPath`: the tsconfig that actually includes those components.
- `importStyle`: `"package"` or `"relative"`.
- `importTarget`: package name or path used when importing components (omit/empty if using relative imports).
- Optional: `recipesPath` or theme/tokens path if it clearly exists. Leave missing if uncertain.
- Keep `manifestVersion: 1` and `tsconfigPaths: []` unless you have confident path mappings.

Paths must be absolute and must exist. If you cannot choose a single value, set the manifest field to `null` and record candidates in the report.

## How to discover (minimal IO; stay scoped)
- tsconfig: list `tsconfig*.json`, follow `extends`, and pick the config whose `include`/`files` cover the chosen component root. Prefer more specific configs. One or two `cat`/`rg` calls are enough.
- component root: use directory listings and re-export index files to infer component names. Avoid opening implementation files; rely on index barrels and package metadata.
- import target/style: infer from `package.json` and observed import patterns in the root index; keep to a few targeted reads.
- recipes/theme: only set if you find a concrete path like `*/theme/recipes`, `*/theme`, `*/tokens`, etc., via `ls`/`rg`.
- Use the provided Figma component list to stay scoped: propose React exports that likely map to those names. Only add direct parents/children needed for those Figma entries (e.g., TabsRoot for Tabs.Trigger, ButtonIcon for Button). Do NOT enumerate the full component tree beyond the scoped names.
- Stop once you’ve inspected package metadata, the relevant tsconfig(s), the component root index(es), and enough re-export lines to cover the scoped Figma list. No deep dives into component implementations.

## Output format (stdout)
Emit THREE JSON blocks in this order, nothing else between them:

---BEGIN MANIFEST---
{ ...manifest json... }
---END MANIFEST---
---BEGIN COMPONENT-SCOPE---
{
  "fromFigma": [
    {
      "figmaName": "...",
      "figmaId": "...",
      "reactCandidates": ["...", "..."],
      "parents": ["optional parent exports"],
      "children": ["optional child exports"],
      "notes": "optional brief note"
    }
  ],
  "reactComponents": ["union of reactCandidates + parents + children, deduped"],
  "generatedAt": "ISO timestamp",
  "notes": ["anything notable about scoping, optional"]
}
---END COMPONENT-SCOPE---
---BEGIN ORIENTATION-REPORT---
{
  "decisions": {
    "componentRoot": { "value": "...", "confidence": "high|medium|low", "candidates": ["..."], "rationale": "..." },
    "tsconfigPath": { "value": "...", "confidence": "...", "candidates": ["..."], "rationale": "..." },
    "importStyle": { "value": "...", "confidence": "...", "candidates": ["..."], "rationale": "..." },
    "importTarget": { "value": "...", "confidence": "...", "candidates": ["..."], "rationale": "..." },
    "recipesPath": { "value": "... or null", "confidence": "...", "candidates": ["..."], "rationale": "..." },
    "scoping": { "value": "summary of how you matched figma->react (with parents/children)", "confidence": "...", "candidates": [], "rationale": "..." }
  },
  "notes": ["anything notable or uncertain, optional"]
}
---END ORIENTATION-REPORT---

Rules:
- All chosen paths must exist; otherwise set the manifest field to null and list candidates with rationale.
- Keep the scope tightly focused on the provided Figma list; do not enumerate unrelated components.
- Be concise and deterministic; avoid guesses without evidence.
