# Scripts Directory

This directory contains utility scripts for working with Figma Code Connect configuration and component data extraction.

## Table of Contents

- [Overview](#overview)
 - [Available Scripts](#available-scripts)
 - [Agent Runner (Codex/Claude)](#agent-runner-codexclaude)
 - [Setup](#setup)
- [Usage Guide](#usage-guide)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

## Overview

This collection of scripts helps automate the process of:

1. **Extracting component data** from Figma files
2. **Extracting component props** from React/TypeScript source code
3. **Generating Figma Code Connect configurations**
4. **Managing design system component mappings**

## Available Scripts

### 1. `code-component-scanner.js` - React Props Scanner (replacement for `extractComponentProps.js`)

**Purpose**: Extracts React component properties and metadata from TypeScript using the TypeScript checker. Outputs JSON compatible with the pipeline (same shape as the legacy extractor).

**Key Features**:

- Resolves exported components via the TypeScript program (fewer false positives)
- Extracts props with union values and basic JSDoc descriptions
- Integrates with Chakra recipe variants when a recipes path is provided
- Generates structured JSON files for each component
- Supports `--manifest` (preferred) plus dry-run, filter, verbose modes

**Output**: JSON files in `components-props/` (or chosen output) with prop metadata, recipe variants, and Figma mapping hints.

### 2. `buildFigmaConfig.js` - Configuration Generator

**Purpose**: Generates `figma.config.json` files from JSON component data following Figma Code Connect standards (default output: `artifacts/codeconnect/figma.config.json`).

**Key Features**:

- Beginner-friendly output with all configurable properties visible
- Follows official Figma Code Connect standards
- Supports command-line customization
- Auto-generates `documentUrlSubstitutions` from JSON files
- Proper node ID format conversion (colon to hyphen)

### 3. `fetchComponents.js` - Component Data Extractor

**Purpose**: Extracts component variant data from Figma files and saves as JSON files.

**Key Features**:

- Downloads all component variants from Figma
- JSON-only output (old format flags removed)
- Filters by page or specific components
- Creates structured component metadata

## Agent Runner (Codex/Claude)

`scripts/agentRunner.js` is a provider-agnostic stdin/stdout harness used by the v3 pipeline. It keeps the pipeline contract steady while swapping agents and exposes a focused toolset when using Claude.

- Providers: `--provider codex|claude` (default: `codex`). Set `--model <name>` as needed.
- Tools (Claude): `list_files`, `read_file`, `rg_search`, `exec_shell` (default on; disable with `--no-exec`), `write_file`.
- Guards: root defaults to cwd; pipeline sets `AGENT_ROOT` to `artifacts/` and allowlists the repo + artifacts. Override with `--root`, `--allow-read`, `--allow-write`.
- Codex path: pipes stdin → codex CLI. Override command with `--codex-cmd "codex --exec --cd ."` if your local binary differs.
- Claude path: requires `@anthropic-ai/claude-agent-sdk` and `ANTHROPIC_API_KEY`. Optional `--system-prompt` to override the default tool primer.
- Defaults come from `superconnect.toml` (`config.agent_provider` + `config.model`); the v3 pipeline auto-builds `node scripts/agentRunner.js --provider=... --model=...`.

Example with the v3 pipeline:

```bash
node scripts/runPipelineV3.js \
  --figma-url <url|key> \
  --figma-token <token> \
  --repo-path ../chakra-ui
```

A ready-to-run default is already in `superconnect.toml` (Codex). A Claude variant is commented in that file if you want to flip providers without touching the CLI.

## Setup

### Prerequisites

1. **Node.js** (v14 or higher)
2. **Figma Access Token** - Get from [Figma Account Settings](https://www.figma.com/developers/api#access-tokens)
3. **Figma File Key** - Extract from your Figma file URL

### Environment Configuration

Create a `.env` file in the project root:

```bash
# Required: Figma API credentials
FIGMA_ACCESS_TOKEN=figd_your_access_token_here
```

Provide the Figma file key at runtime via CLI (`<fileKey>` arg or `--file-key <fileKey|URL>`).

**Finding Your Figma File Key**:
From URL: `https://www.figma.com/design/mgzCV3zD3iWpctEI6UoUhB/My-Design-System`
File Key: `mgzCV3zD3iWpctEI6UoUhB`

## Usage Guide

### Extracting React Component Props

#### Basic Usage

```bash
# Extract all components with default settings
node scripts/code-component-scanner.js

# Extract with verbose output
node scripts/code-component-scanner.js --verbose

# Preview without writing files (dry run)
node scripts/code-component-scanner.js --dry-run --verbose

# Filter specific components
node scripts/code-component-scanner.js --filter button --verbose

# Overwrite existing JSON files
node scripts/code-component-scanner.js --overwrite

# View all options
node scripts/code-component-scanner.js --help
```

#### Command Line Options

| Option | Description | Example |
|--------|-------------|---------|
| `--input` | Component directory to scan | `--input chakra-ui/apps/compositions/src/ui` |
| `--output` | Output directory for JSON files | `--output components-props` |
| `--manifest` | Manifest with componentRoot/recipesPath/tsconfigPath | `--manifest artifacts/codeconnect-manifest.json` |
| `--filter` | Filter by component name | `--filter accordion` |
| `--tsconfig` | Path to tsconfig (required if no manifest) | `--tsconfig tsconfig.json` |
| `--dry-run` | Preview without writing files | `--dry-run` |
| `--verbose` | Show detailed logging | `--verbose` |
| `--overwrite` | Overwrite existing files | `--overwrite` |

#### Generated JSON Structure

The script generates comprehensive component metadata:

```json
{
  "componentName": "Button",
  "filePath": "chakra-ui/apps/compositions/src/ui/button.tsx",
  "relativePath": "./chakra-ui/apps/compositions/src/ui/button.tsx",
  "exportType": "forwardRef",
  "exportName": "Button",
  "interfaceName": "ButtonProps",
  "extendsInterface": "HTMLChakraProps<'button', ButtonBaseProps>",
  "description": "",
  "props": [
    {
      "name": "loading",
      "type": "boolean",
      "required": false,
      "defaultValue": null,
      "description": "If true, the button will show a loading spinner",
      "category": "behavior",
      "unionValues": []
    }
  ],
  "recipeVariants": [
    {
      "name": "size",
      "type": "\"2xs\" | \"xs\" | \"sm\" | \"md\" | \"lg\" | \"xl\" | \"2xl\"",
      "required": false,
      "defaultValue": null,
      "description": "Recipe variant: size",
      "category": "variant",
      "unionValues": ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"],
      "source": "recipe"
    },
    {
      "name": "variant",
      "type": "\"solid\" | \"subtle\" | \"surface\" | \"outline\" | \"ghost\" | \"plain\"",
      "required": false,
      "defaultValue": null,
      "description": "Recipe variant: variant",
      "category": "variant",
      "unionValues": ["solid", "subtle", "surface", "outline", "ghost", "plain"],
      "source": "recipe"
    }
  ],
  "variantProperties": {
    "size": ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"],
    "variant": ["solid", "subtle", "surface", "outline", "ghost", "plain"]
  },
  "totalProps": 3,
  "potentialFigmaMapping": {
    "size": "figma.enum",
    "variant": "figma.enum",
    "loading": "figma.boolean"
  }
}
```

### Building Figma Code Connect Configuration

#### Configuration Generation Commands

```bash
# Generate minimal configuration (console output)
node scripts/buildFigmaConfig.js

# Generate configuration file
node scripts/buildFigmaConfig.js --output file

# View all options
node scripts/buildFigmaConfig.js --help
```

#### Configuration Options

| Option | Description | Example |
|--------|-------------|---------|
| `--input` | Input directory with JSON files | `--input ./figma-variants` |
| `--output` | Output format: `console`, `json`, `file` | `--output file` |
| `--output-file` | Path for the config file when `--output file` | `--output-file artifacts/codeconnect/figma.config.json` |
| `--file-key` | Figma file key or full Figma URL (required) | `--file-key https://www.figma.com/design/abc123xyz` |
| `--parser` | Parser type: `react`, `html`, `swift`, `compose` | `--parser react` |
| `--include` | Include paths (comma-separated) | `--include "src/**,packages/**"` |
| `--exclude` | Exclude paths (comma-separated) | `--exclude "**/*.test.js,docs/**"` |
| `--import-paths` | Import path mappings | `--import-paths "src/components/*=>@ui/components"` |
| `--paths` | TypeScript path mappings | `--paths "@ui/*=>src/components/*"` |
| `--custom-subs` | Custom URL substitutions | `--custom-subs "<BASE>=>/design/file"` |

#### Generated Configuration Structure

The script generates a standards-compliant `figma.config.json`:

```json
{
  "codeConnect": {
    "interactiveSetupFigmaFileUrl": "https://www.figma.com/design/...",
    "include": [],
    "exclude": [],
    "parser": "react",
    "importPaths": {
      "src/components/*": "@ui/components"
    },
    "paths": {
      "@ui/components/*": ["src/components/*"]
    },
    "documentUrlSubstitutions": {
      "<BUTTON>": "https://www.figma.com/design/...?node-id=148-1720",
      "<CARD>": "https://www.figma.com/design/...?node-id=339-15634"
    }
  }
}
```

### Fetching Component Data

#### Fetching Commands

```bash
# Extract all components (file key required)
node scripts/fetchComponents.js <fileKey|Figma URL>

# Extract with a specific file key
node scripts/fetchComponents.js mgzCV3zD3iWpctEI6UoUhB

# Extract with options
node scripts/fetchComponents.js https://www.figma.com/design/abc123xyz --output ./components
```

#### Fetching Options

| Option | Description | Example |
|--------|-------------|---------|
| `--file-key` | Figma file key or full Figma URL (positional arg also supported) | `--file-key mgzCV3zD3iWpctEI6UoUhB` |
| `--token` | Figma API token (overrides .env) | `--token figd_xxx` |
| `--page` | Specific page name to process | `--page "Components"` |
| `--component` | Specific component name | `--component "Button"` |
| (no format flag) | Output format: JSON only | n/a |
| `--output` | Output directory | `--output ./figma-variants` |

## Examples

### Example 1: Complete Workflow with Props Extraction

```bash
# Step 1: Extract component props from React/TypeScript source
node scripts/code-component-scanner.js --manifest artifacts/codeconnect-manifest.json --verbose --overwrite

# Step 2: Extract component data from Figma
node scripts/fetchComponents.js mgzCV3zD3iWpctEI6UoUhB --output ./components

# Step 3: Generate Figma Code Connect configuration
node scripts/buildFigmaConfig.js --output file
```

### Example 2: Extract Specific Component Props

```bash
# Extract only accordion components
node scripts/code-component-scanner.js --manifest artifacts/codeconnect-manifest.json --filter accordion --verbose

# Dry run to preview button component extraction
node scripts/code-component-scanner.js --manifest artifacts/codeconnect-manifest.json --filter button --dry-run --verbose
```

### Example 3: Custom Design System Setup

```bash
# Generate configuration for a design system
node scripts/buildFigmaConfig.js \
  --output file \
  --include "packages/react/src/components/**" \
  --exclude "**/*.test.tsx,**/*.stories.tsx" \
  --import-paths "src/components/*=>@my-design-system/react" \
  --paths "@my-design-system/*=>packages/react/src/*"
```

### Example 4: Chakra UI Style Configuration

```bash
# Generate Chakra UI style configuration
node scripts/buildFigmaConfig.js \
  --output file \
  --include "packages/react/**" \
  --exclude "packages/react/icons.tsx" \
  --import-paths "components/**=>@chakra-ui/react,theme/**=>@chakra-ui/react/theme" \
  --custom-subs "<FIGMA_ICONS_BASE>=>/design/mgzCV3zD3iWpctEI6UoUhB"
```

### Example 5: Extract Specific Components from Figma

```bash
# Extract only Button components from specific page
node scripts/fetchComponents.js \
  --page "Design System" \
  --component "Button" \
  --output ./button-variants
```

## Output Files

### Generated JSON Files from code-component-scanner.js (same shape as legacy extractor)

Located in `components-props/` directory:

```json
{
  "componentName": "Button",
  "filePath": "chakra-ui/apps/compositions/src/ui/button.tsx",
  "relativePath": "./chakra-ui/apps/compositions/src/ui/button.tsx",
  "exportType": "forwardRef",
  "props": [
    { "name": "loading", "type": "boolean", "required": false, "category": "behavior" }
  ],
  "recipeVariants": [
    { "name": "size", "unionValues": ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"], "source": "recipe" },
    { "name": "variant", "unionValues": ["solid", "subtle", "surface", "outline", "ghost", "plain"], "source": "recipe" }
  ],
  "variantProperties": {
    "size": ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"],
    "variant": ["solid", "subtle", "surface", "outline", "ghost", "plain"]
  },
  "totalProps": 3,
  "potentialFigmaMapping": {
    "size": "figma.enum",
    "variant": "figma.enum",
    "loading": "figma.boolean"
  }
}
```

**Key Features**:
- Complete prop metadata with TypeScript types
- Recipe variant integration from Chakra UI theme system
- Figma mapping suggestions for Code Connect
- Handles re-exports (0 props is correct for re-exported components)

### Generated JSON Files from fetchComponents.js

Located in `figma-variants/` directory:

```json
{
  "componentName": "Button",
  "componentSetId": "148:1720",
  "description": "Primary button component",
  "variantProperties": {
    "State": ["default", "hover"],
    "Size": ["medium"]
  },
  "variants": [
    { "name": "Default", "properties": { "State": "default", "Size": "medium" } },
    { "name": "Hover", "properties": { "State": "hover", "Size": "medium" } }
  ]
}
```

### Generated figma.config.json from buildFigmaConfig.js

- **Beginner-friendly**: Shows all configurable properties
- **Standards-compliant**: Follows official Figma documentation
- **Customizable**: Populates with your values when provided

## Troubleshooting

### Common Issues

#### 1. Missing Environment Variables

**Error**: `Error: Figma file key is required`

**Solution**:

```bash
# Provide the file key on the CLI
node scripts/fetchComponents.js <fileKey|Figma URL> --output ./figma-components

# Ensure your token is present in .env
FIGMA_ACCESS_TOKEN=your_token_here
```

#### 2. Invalid Figma File Key

**Error**: `Error: Failed to fetch file data`

**Solution**:

- Verify file key is correct
- Ensure you have access to the Figma file
- Check if file is published/accessible

#### 3. Permission Issues

**Error**: `Error: Insufficient permissions`

**Solution**:

- Regenerate your Figma access token
- Ensure token has proper permissions
- Verify you're a member of the Figma team/organization

#### 4. No Components Found

**Warning**: `No valid components found`

**Solution**:

- For `buildFigmaConfig.js`: Check if JSON files exist in input directory
- For `code-component-scanner.js`: Verify input directory path is correct and `tsconfigPath` resolves
- Verify JSON files have required fields (`componentName`, `componentSetId`)
- Run `fetchComponents.js` first to generate Figma variant data
- Run `code-component-scanner.js` to generate component props data

### Debug Mode

Enable verbose logging by setting environment variable:

```bash
DEBUG=1 node scripts/buildFigmaConfig.js --output console
```

## Best Practices

### 1. Workflow Recommendations

1. **Extract props from source code**: Run `code-component-scanner.js` to analyze React components
2. **Extract Figma variants**: Run `fetchComponents.js` to get Figma component data
3. **Generate configuration**: Run `buildFigmaConfig.js` to create Code Connect config
4. **Test configuration**: Use `--output console` or `--dry-run` to preview before generating files
5. **Iterate on settings**: Use command-line options to customize before committing to files
6. **Version control**: Include generated `figma.config.json` and JSON files in your repository

### 2. Understanding Component Props Output

- **Empty props arrays are valid**: Re-exported components (e.g., `export const X = Y`) correctly have 0 props
- **Recipe variants**: Components extending `RecipeProps<"name">` automatically include recipe variants from theme
- **Union types**: Props like `size?: "sm" | "md" | "lg"` are captured in `unionValues` arrays
- **Figma mappings**: The `potentialFigmaMapping` section suggests appropriate `figma.enum`, `figma.boolean`, etc.

### 3. Naming Conventions

- **Component names**: Use PascalCase (e.g., `Button`, `CardHeader`)
- **File patterns**: Use glob patterns for include/exclude (e.g., `src/**/*.tsx`)
- **Import paths**: Follow your package structure (e.g., `@my-org/components`)

### 4. Configuration Management

- **Environment files**: Use `.env` for sensitive tokens
- **Command-line options**: Use for project-specific customizations
- **Documentation**: Document your specific configuration choices

## Integration with Figma Code Connect

The scripts work together to prepare your codebase for Figma Code Connect:

1. **`code-component-scanner.js`**: Analyzes React components to extract props and recipe variants (requires `tsconfigPath`)
   - Output: `react-components/*.json` (or `components-props/*.json`) - Complete prop metadata for each component

2. **`fetchComponents.js`**: Downloads Figma component variant data
   - Output: `figma-components/*.json` - Figma component structure and variants

3. **`buildFigmaConfig.js`**: Generates the configuration file
   - Output: `figma.config.json` - Figma Code Connect configuration

4. **Next Phase**: Use the generated data to create `.figma.tsx` Code Connect files

This pipeline enables automated generation of Figma Code Connect definitions by combining:
- Component prop types from source code
- Recipe variants from theme system
- Figma component structure and variants
- Proper path mappings and configuration
