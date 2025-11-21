# Scripts Directory

This directory contains utility scripts for working with Figma Code Connect configuration and component data extraction.

## Table of Contents

- [Overview](#overview)
- [Available Scripts](#available-scripts)
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

### 1. `extractComponentProps.js` - React Props Extractor

**Purpose**: Extracts React component properties and metadata from TypeScript files to generate YAML files for Figma Code Connect integration.

**Key Features**:

- Parses TypeScript/React components using AST analysis
- Extracts props with accurate TypeScript types and union values
- Integrates with Chakra UI recipe system for variant definitions
- Generates structured YAML files for each component
- Supports multiple export patterns (forwardRef, function, re-exports)
- CLI with dry-run, filter, and verbose modes

**Output**: YAML files in `components-props/` directory with complete prop metadata, recipe variants, and Figma mapping suggestions.

### 2. `buildFigmaConfig.js` - Configuration Generator

**Purpose**: Generates `figma.config.json` files from YAML component data following Figma Code Connect standards.

**Key Features**:

- Beginner-friendly output with all configurable properties visible
- Follows official Figma Code Connect standards
- Supports command-line customization
- Auto-generates `documentUrlSubstitutions` from YAML files
- Proper node ID format conversion (colon to hyphen)

### 3. `fetchComponents.js` - Component Data Extractor

**Purpose**: Extracts component variant data from Figma files and saves as YAML/JSON files.

**Key Features**:

- Downloads all component variants from Figma
- Supports multiple output formats (JSON, YAML, both)
- Filters by page or specific components
- Creates structured component metadata

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
node scripts/extractComponentProps.js

# Extract with verbose output
node scripts/extractComponentProps.js --verbose

# Preview without writing files (dry run)
node scripts/extractComponentProps.js --dry-run --verbose

# Filter specific components
node scripts/extractComponentProps.js --filter button --verbose

# Overwrite existing YAML files
node scripts/extractComponentProps.js --overwrite

# View all options
node scripts/extractComponentProps.js --help
```

#### Command Line Options

| Option | Description | Example |
|--------|-------------|---------|
| `--input` | Component directory to scan | `--input chakra-ui/apps/compositions/src/ui` |
| `--output` | Output directory for YAML files | `--output components-props` |
| `--recipes` | Recipe directory path | `--recipes chakra-ui/packages/react/src/theme/recipes` |
| `--filter` | Filter by component name | `--filter accordion` |
| `--dry-run` | Preview without writing files | `--dry-run` |
| `--verbose` | Show detailed logging | `--verbose` |
| `--overwrite` | Overwrite existing files | `--overwrite` |

#### Generated YAML Structure

The script generates comprehensive component metadata:

```yaml
componentName: "Button"
filePath: "chakra-ui/apps/compositions/src/ui/button.tsx"
relativePath: "./chakra-ui/apps/compositions/src/ui/button.tsx"
exportType: "forwardRef"
exportName: "Button"
interfaceName: "ButtonProps"
extendsInterface: "HTMLChakraProps<'button', ButtonBaseProps>"
description: ""
props:
  - name: "loading"
    type: "boolean"
    required: false
    defaultValue: null
    description: "If true, the button will show a loading spinner"
    category: "behavior"
    unionValues: []
recipeVariants:
  - name: "size"
    type: '"2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl"'
    required: false
    defaultValue: null
    description: "Recipe variant: size"
    category: "variant"
    unionValues: ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"]
    source: "recipe"
  - name: "variant"
    type: '"solid" | "subtle" | "surface" | "outline" | "ghost" | "plain"'
    required: false
    defaultValue: null
    description: "Recipe variant: variant"
    category: "variant"
    unionValues: ["solid", "subtle", "surface", "outline", "ghost", "plain"]
    source: "recipe"
variantProperties:
  size: ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"]
  variant: ["solid", "subtle", "surface", "outline", "ghost", "plain"]
totalProps: 3
potentialFigmaMapping:
  size: "figma.enum"
  variant: "figma.enum"
  loading: "figma.boolean"
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
| `--input` | Input directory with YAML files | `--input ./figma-variants` |
| `--output` | Output format: `console`, `json`, `file` | `--output file` |
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
node scripts/fetchComponents.js https://www.figma.com/design/abc123xyz --format yaml --output ./components
```

#### Fetching Options

| Option | Description | Example |
|--------|-------------|---------|
| `--file-key` | Figma file key or full Figma URL (positional arg also supported) | `--file-key mgzCV3zD3iWpctEI6UoUhB` |
| `--token` | Figma API token (overrides .env) | `--token figd_xxx` |
| `--page` | Specific page name to process | `--page "Components"` |
| `--component` | Specific component name | `--component "Button"` |
| `--format` | Output format: `json`, `yaml`, `both` | `--format both` |
| `--output` | Output directory | `--output ./figma-variants` |

## Examples

### Example 1: Complete Workflow with Props Extraction

```bash
# Step 1: Extract component props from React/TypeScript source
node scripts/extractComponentProps.js --verbose --overwrite

# Step 2: Extract component data from Figma
node scripts/fetchComponents.js mgzCV3zD3iWpctEI6UoUhB --format yaml

# Step 3: Generate Figma Code Connect configuration
node scripts/buildFigmaConfig.js --output file
```

### Example 2: Extract Specific Component Props

```bash
# Extract only accordion components
node scripts/extractComponentProps.js --filter accordion --verbose

# Dry run to preview button component extraction
node scripts/extractComponentProps.js --filter button --dry-run --verbose
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
  --format yaml \
  --output ./button-variants
```

## Output Files

### Generated YAML Files from extractComponentProps.js

Located in `components-props/` directory:

```yaml
componentName: Button
filePath: chakra-ui/apps/compositions/src/ui/button.tsx
relativePath: ./chakra-ui/apps/compositions/src/ui/button.tsx
exportType: forwardRef
props:
  - name: loading
    type: boolean
    required: false
    category: behavior
recipeVariants:
  - name: size
    unionValues: ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"]
    source: recipe
  - name: variant
    unionValues: ["solid", "subtle", "surface", "outline", "ghost", "plain"]
    source: recipe
variantProperties:
  size: ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"]
  variant: ["solid", "subtle", "surface", "outline", "ghost", "plain"]
totalProps: 3
potentialFigmaMapping:
  size: figma.enum
  variant: figma.enum
  loading: figma.boolean
```

**Key Features**:
- Complete prop metadata with TypeScript types
- Recipe variant integration from Chakra UI theme system
- Figma mapping suggestions for Code Connect
- Handles re-exports (0 props is correct for re-exported components)

### Generated YAML Files from fetchComponents.js

Located in `figma-variants/` directory:

```yaml
componentName: Button
componentSetId: 148:1720
description: Primary button component
variants:
  - name: Default
    properties:
      State: default
      Size: medium
  - name: Hover
    properties:
      State: hover
      Size: medium
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
node scripts/fetchComponents.js <fileKey|Figma URL> --format yaml

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

- For `buildFigmaConfig.js`: Check if YAML files exist in input directory
- For `extractComponentProps.js`: Verify input directory path is correct
- Verify YAML files have required fields (`componentName`, `componentSetId`)
- Run `fetchComponents.js` first to generate Figma variant data
- Run `extractComponentProps.js` to generate component props data

### Debug Mode

Enable verbose logging by setting environment variable:

```bash
DEBUG=1 node scripts/buildFigmaConfig.js --output console
```

## Best Practices

### 1. Workflow Recommendations

1. **Extract props from source code**: Run `extractComponentProps.js` to analyze React components
2. **Extract Figma variants**: Run `fetchComponents.js` to get Figma component data
3. **Generate configuration**: Run `buildFigmaConfig.js` to create Code Connect config
4. **Test configuration**: Use `--output console` or `--dry-run` to preview before generating files
5. **Iterate on settings**: Use command-line options to customize before committing to files
6. **Version control**: Include generated `figma.config.json` and YAML files in your repository

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

1. **`extractComponentProps.js`**: Analyzes React components to extract props and recipe variants
   - Output: `components-props/*.yaml` - Complete prop metadata for each component

2. **`fetchComponents.js`**: Downloads Figma component variant data
   - Output: `figma-variants/*.yaml` - Figma component structure and variants

3. **`buildFigmaConfig.js`**: Generates the configuration file
   - Output: `figma.config.json` - Figma Code Connect configuration

4. **Next Phase**: Use the generated data to create `.figma.tsx` Code Connect files

This pipeline enables automated generation of Figma Code Connect definitions by combining:
- Component prop types from source code
- Recipe variants from theme system
- Figma component structure and variants
- Proper path mappings and configuration
