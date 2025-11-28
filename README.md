# Superconnect: Figma ↔ Code Connect Generator

Superconnect is an AI-enhanced tool that writes your Figma Code Connect files for you. It takes these inputs:

- A Figma design system file
- An associated component repo (assumed to be React + Typescript)

And it outputs (in your repo):

- `figma.config.json` at top level
- `codeconnect/` directory with Figma Code Connect `.figma.tsx` files
- Summary and intermediate files in `superconnect/`


# Quickstart

1. Install deps once: `npm install`
2. Run the pipeline (from the repo root):
   ```
   npx superconnect --figma-url "<FIGMA_FILE_URL_OR_KEY>" --figma-token "<FIGMA_TOKEN>" --target <path-to-react-repo>
   ```
   - Skip `--figma-url` if `superconnect/figma-components-index.json` already exists and config covers it.
   - Use `--force` to rerun all stages.
3. Outputs land in `superconnect/` (figma data, repo summary, orientation, logs) and `codeconnect/` for generated `.figma.tsx`, plus `SUPERCONNECT_SUMMARY.md`.

Config (superconnect.toml):
```
[agent]
backend = "cli" # or "openai"
cli_command = "codex exec --model gpt-5.1-codex-mini --sandbox read-only" # used when backend=cli
# model = "gpt-4.1-mini" # used when backend=openai (requires OPENAI_API_KEY env)
```


# Pipeline

1. Figma scan (scripts/figma-scan.js)
  - In: Figma URL 
  - Out: superconnect/figma-components-index.json + button.json, accordion.json, etc.

2. Repo summarizer (scripts/summarize-repo.js)
  - In: Repo root
  - Out: repo-summary.json (overview of files, paths, exports)

3. Orienter (scripts/run-orienter.js)
  - In: figma-components.json, repo-summary.json
  - Out: Result of agent call (prompts/orienter.md) => superconnect/orientation.jsonl (each line defines which file contents are needed as input for code gen for each Figma component)

4. Code Gen runner (scripts/run-codegen.js)
  - In: superconnect/orientation.jsonl, contents of superconnect/figma-components/
  - Do: For each line in orientation.jsonl
      - Load files mentioned in orientation
      - Load associated superconnect/figma-components/{component}.json
      - Invoke prompts/codegen-agent.md, inject all files into conetxt
      - Agent returns JSON, unpack the json, write codeconnect/{component}.figma.tsx
  - Out: superconnect/code-gen-log.txt + set of .figma.tsx files under codeconnect/

5. Finalizer (finalize.js)
  - In: contents of codeconnect/ and superconnect/
  - Out: figma.config.json, SUPERCONNECT_SUMMARY.md

