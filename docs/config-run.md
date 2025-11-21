# Config Run Guide

Purpose: generate `figma.config.json` using the Figma variants YAMLs and the manifest for import/path defaults.

Inputs:
- Figma YAMLs: `artifacts/figma-components`
- Manifest (defaults to): `artifacts/codeconnect-manifest.json` for import paths/aliases
- Figma file key or URL

Command (writes `figma.config.json` in the repo root):
```
node scripts/buildFigmaConfig.js \
  --input artifacts/figma-components \
  --file-key https://www.figma.com/design/mgzCV3zD3iWpctEI6UoUhB/Chakra-UI \
  --manifest artifacts/codeconnect-manifest.json \
  --output file
```

Notes:
- The script reads `--manifest` (default `artifacts/codeconnect-manifest.json`) to prefill `importPaths`/`paths`. CLI flags `--import-paths` and `--paths` override the manifest values if provided.
- `--include` / `--exclude` can narrow or expand the Code Connect scan; omit them to keep empty arrays.
- Use a file key or full Figma URL for `--file-key`.
