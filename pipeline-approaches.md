  | Task | Deterministic Code | LLM | LLM+Tools (rg/ast-grep/jq/tsc) |
  | --- | --- | --- | --- |
  | Parse CLI/config inputs | 5 | 1 | 1 |
  | Load secrets (token) | 5 | 1 | 1 |
  | Fetch Figma file via API | 5 | 1 | 1 |
  | Save per-component Figma JSON | 5 | 1 | 1 |
  | Build Figma components index (names/ids/counts) | 5 | 1 | 1 |
  | Validate Figma artifacts exist | 5 | 1 | 1 |
  | List repo root, detect package.json | 5 | 2 | 2 |
  | Detect component root directory | 3 | 4 | 5 |
  | Choose tsconfig for component root | 3 | 4 | 5 |
  | Infer import style (package vs relative) | 3 | 4 | 5 |
  | Infer import target (package name/alias) | 3 | 4 | 5 |
  | Locate recipes/theme path | 2 | 4 | 5 |
  | Produce manifest JSON | 4 | 3 | 4 |
  | Produce orientation report | 2 | 5 | 5 |
  | Produce component scope (from Figma list) | 3 | 4 | 5 |
  | Include parents/children in scope | 2 | 4 | 5 |
  | Validate scope consistency | 5 | 2 | 3 |
  | Scan codebase for exports (TS checker) | 5 | 2 | 3 |
  | Filter exports to scoped list | 5 | 2 | 3 |
  | Extract props/types per component | 5 | 2 | 3 |
  | Extract variantProperties/recipeVariants | 5 | 2 | 3 |
  | Generate potential Figma mapping hints | 4 | 3 | 4 |
  | Write React component JSON artifacts | 5 | 1 | 2 |
  | Match Figma names to React names | 2 | 5 | 5 |
  | Handle subcomponent naming (Tabs.Trigger) | 2 | 5 | 5 |
  | Score match candidates (certain/uncertain) | 3 | 5 | 5 |
  | Write match-candidates.jsonl | 5 | 1 | 2 |
  | Review matches interactively | 2 | 4 | 4 |
  | Auto-accept certain matches | 5 | 1 | 2 |
  | Build mappings.json | 5 | 1 | 2 |
  | Compute import path per manifest | 5 | 2 | 3 |
  | Align Figma variant keys to React props | 3 | 5 | 5 |
  | Choose enum values (React vs Figma) | 3 | 5 | 5 |
  | Choose booleans/strings/instances | 3 | 5 | 5 |
  | Handle known patterns (Button colorScheme) | 2 | 5 | 5 |
  | Detect unmapped variant keys | 5 | 2 | 3 |
  | Generate .figma.tsx per mapping | 4 | 3 | 4 |
  | Sanitize filenames | 5 | 1 | 2 |
  | Write codeconnect/ outputs | 5 | 1 | 2 |
  | Build figma.config.json | 5 | 1 | 2 |
  | Summarize coverage (mapped/unmapped) | 5 | 2 | 3 |
  | Validate artifacts (existence/schema) | 5 | 1 | 2 |
  | Produce final run report | 4 | 3 | 4 |
  | Retry missing pieces | 4 | 3 | 4 |
  | Enforce blinder rules (scope/sandbox) | 4 | 3 | 4 |
  | Log agent outputs | 5 | 1 | 2 |