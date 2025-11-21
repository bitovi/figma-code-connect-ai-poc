# Config Run Guide

Purpose: generate `figma.config.json` (in `artifacts/codeconnect/`) using the Figma variants JSON files and the manifest for import/path defaults.

Inputs:
- Figma JSON: `artifacts/figma-components`
- Manifest (defaults to): `artifacts/codeconnect-manifest.json` for import paths/aliases
- Figma file key or URL

Command (writes `artifacts/codeconnect/figma.config.json`):
```
node scripts/buildFigmaConfig.js \
  --input artifacts/figma-components \
  --file-key https://www.figma.com/design/mgzCV3zD3iWpctEI6UoUhB/Chakra-UI \
  --manifest artifacts/codeconnect-manifest.json \
  --output file \
  --output-file artifacts/codeconnect/figma.config.json
```

Notes:
- The script reads `--manifest` (default `artifacts/codeconnect-manifest.json`) to prefill `importPaths`/`paths`. CLI flags `--import-paths` and `--paths` override the manifest values if provided.
- `--output-file` lets you place the config elsewhere; default is `figma.config.json` if not specified.
- `--include` / `--exclude` can narrow or expand the Code Connect scan; omit them to keep empty arrays.
- Use a file key or full Figma URL for `--file-key`.
