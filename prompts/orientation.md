# Orientation Agent Prompt

Goal: locate the React component root/import strategy for a user-specified repo and write a manifest JSON. 

Inputs:
- A target repo path provided by the user (treat as `<REPO_ROOT>`). Stay within it.
- Tools: `ls`, `cat`, targeted `rg --files -g '*.tsx'`, small `node` snippets if needed.

Constraints:
- Do not run git status or broad scans of the current repo; focus on `<REPO_ROOT>`.
- Keep commands minimal; avoid dumping large files/dirs.
- Ensure `artifacts/` exists before writing the manifest.
- Do not emit a separate plan; execute the steps directly.

Required manifest fields (JSON):
- `manifestVersion`: 1
- `componentRoot`: path to the component root (workspace-relative preferred)
- `recipesPath`: optional path if recipes exist
- `importStyle`: one of `package | alias | relative` (default to `package` unless evidence suggests alias/relative)
- `importTarget`: package/alias/base path
- `tsconfigPaths`: optional alias map if found in tsconfig
- `notes`: short summary of assumptions/choices

Do this directly (no planning output):
1) Confirm `<REPO_ROOT>` exists.
2) List likely component areas (e.g., `apps`, `packages`, `src`) and take a minimal sample of `.tsx` locations via `rg --files -g '*.tsx' <REPO_ROOT>` or targeted `find` to pick the densest React area as `componentRoot`.
3) Look for recipes/theme under `<REPO_ROOT>` (e.g., `**/recipes`), sampling one or two files to confirm; set `recipesPath` or omit if absent.
4) Inspect `<REPO_ROOT>/package.json` for a package `name` aligned with the component root; if present, prefer `importStyle: package` and `importTarget: <name>`. If tsconfig `paths` point to the root, choose `alias` and record them; else fallback to `relative`.
5) Check `<REPO_ROOT>/tsconfig*.json` for `paths` aliases; include any found in `tsconfigPaths`.
6) `mkdir -p artifacts` and write `artifacts/codeconnect-manifest.json` with the required fields.
7) Print a brief summary (root, recipes, import style/target, paths, notes/uncertainties).

Deliverables:
- Manifest JSON saved to disk.
- Text summary of detected roots, import strategy, path aliases (if any), and any open questions.
