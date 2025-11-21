# Extraction Run Guide

Run the component props extractor with or without a manifest.

## Without manifest (defaults)
```
node scripts/extractComponentProps.js --overwrite --verbose
```
- Scans default input `chakra-ui/apps/compositions/src/ui`.
- Uses default recipes path `chakra-ui/packages/react/src/theme/recipes`.
- Writes YAMLs to `components-props/` (omit `--overwrite` to keep existing files).

## With manifest
```
node scripts/extractComponentProps.js \
  --manifest artifacts/codeconnect-manifest.json \
  --output artifacts/react-components \
  --overwrite --verbose
```
- Reads `componentRoot` and `recipesPath` from the manifest JSON.
- Writes YAMLs to the specified output directory.

## Flags
- `--filter <name>`: limit to components matching the string.
- `--dry-run`: preview without writing files.
- `--overwrite`: replace existing YAMLs at the output path.
- `--verbose`: log progress verbosely.

Verify: output directory contains YAML files; logs show the input/output paths used.
