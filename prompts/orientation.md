# Orientation Agent Prompt

Goal: infer component roots, recipes, and import strategy for an arbitrary repo with minimal user questions. Produce a self-documenting manifest JSON (include manifestVersion and notes) plus a short summary.

Inputs available:
- Files on disk (git worktree).
- Tools: `rg`, `ast-grep`, `ls`, `cat`, `node` for small scripts, `jq` if needed.

Tasks:
1) Detect monorepo/workspaces: inspect root `package.json` (`workspaces`), `pnpm-workspace.yaml`, `turbo.json`. Note relevant package paths.
2) Find candidate component roots:
   - Search for directories rich in `.tsx`/`.ts` with React imports (`from "react"`, `forwardRef`, JSX).
   - Common patterns: `src/components`, `apps/*/src/ui`, `packages/*/src`, `components/`.
   - Rank by TSX count and presence of index/barrel files; prefer the densest React area.
3) Optional recipes/theme variants: look for `theme/recipes` or `recipes` under `src`/`packages`; verify by sampling files.
4) Determine import strategy:
   - If a package likely owns the component root (package.json `name` aligned with root), choose `importStyle: package` and set `importTarget` to that name.
   - Else, if tsconfig `paths` point to the root, choose `importStyle: alias`, set `importTarget` to the alias, and capture the relevant `paths`.
   - Else fallback to `importStyle: relative` with `importTarget` as the base path.
5) Emit manifest JSON with fields: manifestVersion, componentRoot, optional recipesPath, importStyle, importTarget, optional tsconfigPaths, optional notes. Save to `artifacts/codeconnect-manifest.json` (or a provided path).
6) Output a brief summary explaining choices and any uncertainties.

Heuristics:
- Prefer a single componentRoot. If multiple tie, pick the one with highest React density/exports; if still ambiguous, list top two with rationale.
- Keep paths workspace-relative where possible.
- If recipes/theme not found, leave `recipesPath` unset and note it.

Deliverables:
- Manifest JSON saved to disk.
- Text summary of detected roots, import strategy, and any open questions.
