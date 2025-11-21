# CodeGen Agent Prompt

Goal: Generate Code Connect `.figma.tsx` files linking Figma components to React components using only the files in your current working directory.

Your Inputs:
- Manifest JSON: `codeconnect-manifest.json` that captures where components live, recipes path, and how imports should be resolved
- Approved mappings JSON: `mappings.json` (array of {figmaName, reactName}).
- React component YAMLs: `react-components/` (props, filePath, relativePath, potentialFigmaMapping, variantProperties, recipeVariants).
- Figma variant YAMLs: `figma-components/` (variantProperties, variants array).

Execution steps (be direct; no git/status/project scans, no new generator scripts):
1) Use tiny `node -e` or short heredoc scripts to read only the fields you need—do not paste large YAML.
2) For each mapping, find the matching React YAML and Figma YAML. If either is missing, skip and note it.
3) Derive the import path per manifest rules (package/alias/relative).
4) Build props from React YAML + Figma variant keys using the mapping guidance.
5) Write one `.figma.tsx` file per mapping directly to `codeconnect/`; create the directory if needed.
6) Emit a concise summary (counts, skips). Do not create new helper scripts in the repo; write files inline from your snippets.

YAML handling (use this instead of guessing; expect lowercase `.yaml`):
- The `yaml` npm module is installed (`require('yaml')`), files end with `.yaml` (lowercase).
- Load dirs via small snippets, e.g.:
  ```js
  const fs = require('fs'); const path = require('path'); const yaml = require('yaml');
  const loadByName = dir => Object.fromEntries(
    fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f => {
      const data = yaml.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return [data.componentName || path.basename(f, '.yaml'), data];
    })
  );
  const reactMap = loadByName('react-components');
  const figmaMap = loadByName('figma-components');
  ```
- Use these maps keyed by `componentName` (case-insensitive comparisons if needed) to find matching YAMLs for each mapping.
 - Write files inline, e.g.:
   ```js
   const fs = require('fs'); const path = require('path');
   const outDir = 'codeconnect'; fs.mkdirSync(outDir, { recursive: true });
   fs.writeFileSync(path.join(outDir, 'Example.figma.tsx'), '...tsx contents...');
   ```

Output template (apply per mapping):
```ts
import { connect, figma } from '@figma/code-connect';
import { ReactName } from '<resolved-import>';

connect(ReactName, 'FigmaName', {
  props: {
    size: figma.enum('size', ['sm', 'md']),       // derive from Figma variantProperties or React variantProperties
    disabled: figma.boolean('disabled'),          // booleans map to figma.boolean
    icon: figma.instance('icon'),                 // instance-like props use figma.instance
    children: figma.string('children'),           // text/label/content use figma.string
    // omit props that have no clear mapping
  },
});
```
Fill in `ReactName`, `FigmaName`, import path, and props based on the heuristics below. Drop any prop lines that aren’t clearly mapped.

Import resolution:
- `package`: `import { ReactName } from "<importTarget>";`
- `alias`: map the component’s `relativePath` against `manifest.tsconfigPaths` if possible; otherwise join `importTarget` with the path from `componentRoot` (strip extension).
- `relative`: build a relative path from the Code Connect output directory to the component file (strip extension).
- Keep it simple: if alias/relative cannot be confidently resolved, fall back to the package import target and note it in the summary.
- Keep imports minimal; add additional imports only if the component props need them.

Variant/prop mapping guidance:
- Start from the mapping pair `{figmaName, reactName}`.
- Build props from React YAML:
  - Use `props` entries and `potentialFigmaMapping` hints to choose `figma.string`, `figma.boolean`, `figma.enum`, `figma.instance`, etc.
  - If Figma `variantProperties` keys (e.g., `status`, `size`) match React prop names (case-insensitive, strip non-alphanumerics), map them with `figma.enum` using the Figma variant values.
  - If React `variantProperties` or `recipeVariants` are present, prefer their value sets for enums when they align with Figma variant names.
- Treat remaining unmapped props as optional and omit unless clearly needed to render a sensible preview.

Output:
- Write one file per approved mapping to `codeconnect/{reactName}.figma.tsx` (sanitize with alphanumerics/dashes; use the React name for the filename).
- File shape:
  - Imports `connect` and `figma` from `@figma/code-connect`.
  - Imports the React component per the manifest rule.
  - `connect(Component, "FigmaName", { props: { ... } })` with enums/strings/instances based on the heuristics above.
- Emit a short summary: count of files written and any mappings skipped due to missing data.

Constraints:
- Do not invent new components beyond the mappings list.
- If a mapped component lacks a matching Figma YAML or React YAML, skip it and mention in the summary.
- Keep output TypeScript valid and minimal; avoid placeholders that would fail type-checking.
- Avoid repo mutations other than writing the `.figma.tsx` outputs; do not add new scripts or config. No git/bd/status housekeeping commands. Focus solely on generating the files.
- Keep context lean: read files via scripts/tools, not by pasting full contents. It’s OK to write small ephemeral Node snippets to parse YAML/JSON and return only the fields you need for the current mapping.
