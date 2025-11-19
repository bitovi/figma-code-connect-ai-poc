# Figma Code SuperConnector

Typically developers have to write Figma Code Connect mappings by hand.

The Superconnector CLI reads a design‑system Figma file and an associated React codebase, then produces JSON “artifacts” that describe your design and code. A later stage (in progress) will use those artifacts to generate Code Connect modules for you.

This repo is wired for a concrete demo against the Chakra UI design system.

Example project: [Chakra UI](https://github.com/chakra-ui/chakra-ui)

---

## What this repo does

- Reads a Figma design‑system file (Button, Badge, Breadcrumb) and extracts normalized design metadata.
- Reads a Chakra‑UI‑based React codebase and discovers the matching React components and prop models.
- Writes JSON artifacts under `artifacts/`:
  - `design.components.json` (Figma design components + variants).
  - `code.components.json` (React components + props).
- Provides `inspect` commands that pretty‑print YAML slices from those artifacts for debugging.
- Prepares configuration for a later mapping + Code Connect‑generation pipeline (Epics 3–4, still in progress).

---

## Quickstart (Chakra UI demo)

These steps assume you are running the CLI from this repo in development mode.

### 1. Prerequisites

- Node.js and npm.
- A Figma Personal Access Token with access to the Chakra design‑system file.
- The Chakra UI monorepo cloned next to this repo:

```bash
git clone https://github.com/chakra-ui/chakra-ui.git ../chakra-ui
```

### 2. Install and build

From the `figma-code-connect-ai-poc` directory:

```bash
npm install
npm run build
```

The build step compiles the TypeScript sources into `dist/`, including the CLI entrypoint at `dist/cli/index.js`.

### 3. Configure Figma auth

Create a `.env` file in this repo with your Figma PAT. The default configuration expects `FIGMA_PAT`:

```bash
echo 'FIGMA_PAT=your-token-here' > .env
```

You can also generate an `.env.example` and a starter config using:

```bash
node dist/cli/index.js init
```

For this Chakra demo, a tuned `superconnect.config.toml` is already checked in; you typically only need to ensure your `.env` is correct.

### 4. Check Figma auth

Use the `auth check` command to verify that your PAT works:

```bash
node dist/cli/index.js auth check --env-file .env
```

This command:

- Loads `superconnect.config.toml` (or another path via `--config`).
- Loads environment variables from the given `--env-file` (or falls back to the process env).
- Resolves the Figma token from `FIGMA_PAT` (or the configured `tokenEnv`).
- Pings `https://api.figma.com/v1/me` and prints the resolved user handle, email, and ID.

### 5. Pull design components from Figma

```bash
node dist/cli/index.js figma pull --env-file .env
```

This will:

- Load the config and Figma PAT (similar to `auth check`).
- Fetch the configured Figma file (`[figma].file` in `superconnect.config.toml`).
- Extract Button, Badge, and Breadcrumb variants.
- Write `artifacts/design.components.json`.

If there are extraction issues, warnings are printed to stderr.

### 6. Scan the Chakra React codebase

```bash
node dist/cli/index.js code scan
```

This will:

- Load `superconnect.config.toml`.
- Use `[code].root` and `[code].tsconfig` to construct a TypeScript Program.
- Discover React components for the configured `run.components`.
- Infer a simple prop model (`string`/`boolean`/`enum`/`unknown` with optional defaults).
- Write `artifacts/code.components.json`.

If no components are found on the first pass, the CLI automatically retries once after reloading the project. Final warnings are printed to stderr.

### 7. Inspect artifacts

Inspect a single design component (YAML summary):

```bash
node dist/cli/index.js inspect design --component Button
```

Inspect the corresponding code component and its props:

```bash
node dist/cli/index.js inspect code --component Button
```

Both commands load the appropriate artifact from `artifacts/`, locate the requested component by name (case‑insensitive), and print a YAML slice with the most relevant details plus any artifact‑level warnings.

> Note: Future mapping and Code Connect generation commands (Epics 3–4) will build on these artifacts and on the Chakra‑specific heuristics, but those commands are not wired into the CLI yet.

---

## Configuration reference (`superconnect.config.toml`)

`superconnect.config.toml` is the main configuration file for the CLI. For the Chakra demo, a tuned version is already present in the repo:

```toml
[figma]
file = "https://www.figma.com/design/…/Chakra-UI?node-id=580-1767&p=f&m=dev"
tokenEnv = "FIGMA_PAT"

[code]
root = "../chakra-ui/packages/react/src"
tsconfig = "../chakra-ui/packages/react/tsconfig.json"

[run]
components = ["Button","Badge","Breadcrumb"]
mode = "simple"

[paths]
artifactsDir = "artifacts"
modulesDir = "modules/code-connect"
```

You can generate a fresh config with `node dist/cli/index.js init`, which uses the same schema with different defaults.

### `[figma]`

- `file` – Figma file ID or full URL for the design‑system file to analyze. For the demo this points at the Chakra UI design‑system file.
- `tokenEnv` – Name of the environment variable holding your Figma PAT. Defaults to `FIGMA_PAT`.

### `[code]`

- `root` – Path (absolute or relative to the superconnect project) to the root of the React design‑system code. For the demo, this is the Chakra UI React package source under `../chakra-ui`.
- `tsconfig` – Path to the `tsconfig.json` used to construct the TypeScript Program for analysis.

### `[run]`

- `components` – Array of component names to target in both Figma and code (e.g., `["Button","Badge","Breadcrumb"]`). If omitted, the CLI defaults to those three components.
- `mode` – Run mode for the pipeline. Currently only `"simple"` is supported; other values are treated as invalid configuration.

### `[paths]`

- `artifactsDir` – Directory where JSON artifacts (design, code, and future mapping artifacts) are written. Defaults to `artifacts`.
- `modulesDir` – Directory where generated Code Connect modules will be written in later epics. Defaults to `modules/code-connect`.

---

## CLI overview

The CLI command name is `superconnect`. When running directly from this repo during development, use:

```bash
node dist/cli/index.js <command> [options]
```

When the package is installed as a binary (for example via `npm link`), the same commands are available as:

```bash
superconnect <command> [options]
```

### Global usage

- `superconnect help` – Show top‑level help and list commands.
- `superconnect help <command>` – Show help for a specific command group (e.g., `superconnect help figma pull`).
- `superconnect --help` / `superconnect -h` – Show help for the resolved command.
- `superconnect --version` / `superconnect -v` – Print the CLI version.

### Implemented commands

- `superconnect init`
  - Scaffold `superconnect.config.toml` and `.env.example` in the current directory.
  - Takes no positional arguments.

- `superconnect auth check [--config <path>] [--env-file <path>]`
  - Load configuration and environment variables.
  - Resolve the Figma PAT from the configured `tokenEnv`.
  - Call Figma’s `/v1/me` endpoint and print a short profile summary.

- `superconnect figma pull [--config <path>] [--env-file <path>]`
  - Load configuration and Figma PAT.
  - Fetch the configured Figma design‑system file.
  - Extract design components for the configured `run.components`.
  - Write `design.components.json` into `[paths].artifactsDir`.

- `superconnect code scan [--config <path>]`
  - Load configuration.
  - Construct a TypeScript Program rooted at `[code].root` with `[code].tsconfig`.
  - Discover React components matching `run.components`.
  - Write `code.components.json` into `[paths].artifactsDir`.

- `superconnect inspect design --component <Name> [--config <path>]`
  - Load configuration and the design artifact from `[paths].artifactsDir`.
  - Find a design component whose `componentName` matches `<Name>` (case‑insensitive).
  - Print a YAML slice with the component’s variants and relevant metadata.

- `superconnect inspect code --component <Name> [--config <path>]`
  - Load configuration and the code artifact from `[paths].artifactsDir`.
  - Find a code component whose `componentName` matches `<Name>` (case‑insensitive).
  - Print a YAML slice with export/module info, props, notes, and any warnings.

Future commands for mapping (`superconnect map …`), Code Connect generation (`superconnect connect …`), and demo orchestration (`superconnect demo`) will be wired in as Epics 3–5 land. This README will be updated alongside those beads, but the basics above should be enough to run the v1 Chakra demo pipeline (design ingest + code ingest + inspection).

