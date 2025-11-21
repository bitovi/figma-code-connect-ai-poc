## Project Context

Typically developers have to write Figma Code Connect mappings by hand.

The tool we are developing here will be able to 
1. scan a design‑system Figma file and an associated React codebase which implements the components for that design system
2. build an understanding of the mapping between these
3. use that understanding to automagically generate Code Connect modules

This repo is built to demo against the Chakra UI design system. [Chakra UI](https://github.com/chakra-ui/chakra-ui)

The purpose of this project is to create a demo and a blog post -- it is illustrative, a teaching tool.  Elegance, simplicity, succinctness, and approachability are the most important features. Robustness and production-quality is NOT an important feature. We'll only implement the golden path.

# Planning
(IMPORTANT): This project uses **bd (beads)** for planning software engineering tasks. Run `bd quickstart` to learn the tool. For one-off requests I make to you, don't worry about beads. But if I tell you to plan a feature or file a bug, do it with beads.

# Find ready work
bd ready --json | jq '.[0]'

# Create issues during work
bd create "Discovered bug" -t bug -p 0 --json

# Link discovered work back to parent
bd dep add <new-id> <parent-id> --type discovered-from

# Update status
bd update <issue-id> --status in_progress --json

# Complete work
bd close <issue-id> --reason "Implemented" --json

## Repo guidance
- Secrets are in .env-rename
- Chakra-UI repo, which our project uses as its paradigmatic example, is cloned into a sibling directory (../chakrai-ui)

## Tool guidance
- PLEASE use the full "git status" command, NOT "git status -sb", otherwise you won't see the git state that I see, and it will cause confusion. This is important.
- I use Mac, zsh, homebrew

### ast-grep vs ripgrep

**Use `ast-grep` when structure matters.** It parses code and matches AST nodes, so results ignore comments/strings, understand syntax, and can **safely rewrite** code.

* Refactors/codemods: rename APIs, change import forms, rewrite call sites or variable kinds.
* Policy checks: enforce patterns across a repo (`scan` with rules + `test`).
* Editor/automation: LSP mode; `--json` output for tooling.

**Use `ripgrep` when text is enough.** It’s the fastest way to grep literals/regex across files.

* Recon: find strings, TODOs, log lines, config values, or non‑code assets.
* Pre-filter: narrow candidate files before a precise pass.

**Rule of thumb**

* Need correctness over speed, or you’ll **apply changes** → start with `ast-grep`.
* Need raw speed or you’re just **hunting text** → start with `rg`.
* Often combine: `rg` to shortlist files, then `ast-grep` to match/modify with precision.

**Snippets**

Find structured code (ignores comments/strings):

```bash
ast-grep run -l TypeScript -p 'import $X from "$P"'
```

Codemod (only real `var` declarations become `let`):

```bash
ast-grep run -l JavaScript -p 'var $A = $B' -r 'let $A = $B' -U
```

Quick textual hunt:

```bash
rg -n 'console\.log\(' -t js
```

Combine speed + precision:

```bash
rg -l -t ts 'useQuery\(' | xargs ast-grep run -l TypeScript -p 'useQuery($A)' -r 'useSuspenseQuery($A)' -U
```
**Mental model**

* Unit of match: `ast-grep` = node; `rg` = line.
* False positives: `ast-grep` low; `rg` depends on your regex.
* Rewrites: `ast-grep` first-class; `rg` requires ad‑hoc sed/awk and risks collateral edits.

