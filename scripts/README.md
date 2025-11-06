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
2. **Generating Figma Code Connect configurations**
3. **Managing design system component mappings**

## Available Scripts

### 1. `buildFigmaConfig.js` - Configuration Generator

**Purpose**: Generates `figma.config.json` files from YAML component data following Figma Code Connect standards.

**Key Features**:

- Beginner-friendly output with all configurable properties visible
- Follows official Figma Code Connect standards
- Supports command-line customization
- Auto-generates `documentUrlSubstitutions` from YAML files
- Proper node ID format conversion (colon to hyphen)

### 2. `fetchComponents.js` - Component Data Extractor

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
FIGMA_FILE_KEY=your_figma_file_key_here
```

**Finding Your Figma File Key**:
From URL: `https://www.figma.com/design/mgzCV3zD3iWpctEI6UoUhB/My-Design-System`
File Key: `mgzCV3zD3iWpctEI6UoUhB`

## Usage Guide

### Building Figma Code Connect Configuration

#### Basic Usage

```bash
# Generate minimal configuration (console output)
node scripts/buildFigmaConfig.js

# Generate configuration file
node scripts/buildFigmaConfig.js --output file

# View all options
node scripts/buildFigmaConfig.js --help
```

#### Command Line Options

| Option | Description | Example |
|--------|-------------|---------|
| `--input` | Input directory with YAML files | `--input ./figma-variants` |
| `--output` | Output format: `console`, `json`, `file` | `--output file` |
| `--file-key` | Figma file key (overrides .env) | `--file-key abc123xyz` |
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

#### Basic Commands

```bash
# Extract all components (uses .env file)
node scripts/fetchComponents.js

# Extract with specific file key
node scripts/fetchComponents.js mgzCV3zD3iWpctEI6UoUhB

# Extract with options
node scripts/fetchComponents.js --format yaml --output ./components
```

#### Available Options

| Option | Description | Example |
|--------|-------------|---------|
| `--token` | Figma API token (overrides .env) | `--token figd_xxx` |
| `--page` | Specific page name to process | `--page "Components"` |
| `--component` | Specific component name | `--component "Button"` |
| `--format` | Output format: `json`, `yaml`, `both` | `--format both` |
| `--output` | Output directory | `--output ./figma-variants` |

## Examples

### Example 1: Complete Workflow

```bash
# Step 1: Extract component data from Figma
node scripts/fetchComponents.js mgzCV3zD3iWpctEI6UoUhB --format yaml

# Step 2: Generate minimal configuration
node scripts/buildFigmaConfig.js --output file
```

### Example 2: Custom Design System Setup

```bash
# Generate configuration for a design system
node scripts/buildFigmaConfig.js \
  --output file \
  --include "packages/react/src/components/**" \
  --exclude "**/*.test.tsx,**/*.stories.tsx" \
  --import-paths "src/components/*=>@my-design-system/react" \
  --paths "@my-design-system/*=>packages/react/src/*"
```

### Example 3: Chakra UI Style Configuration

```bash
# Generate Chakra UI style configuration
node scripts/buildFigmaConfig.js \
  --output file \
  --include "packages/react/**" \
  --exclude "packages/react/icons.tsx" \
  --import-paths "components/**=>@chakra-ui/react,theme/**=>@chakra-ui/react/theme" \
  --custom-subs "<FIGMA_ICONS_BASE>=>/design/mgzCV3zD3iWpctEI6UoUhB"
```

### Example 4: Extract Specific Components

```bash
# Extract only Button components from specific page
node scripts/fetchComponents.js \
  --page "Design System" \
  --component "Button" \
  --format yaml \
  --output ./button-variants
```

## Output Files

### Generated YAML Files (from fetchComponents.js)

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

### Generated figma.config.json (from buildFigmaConfig.js)

- **Beginner-friendly**: Shows all configurable properties
- **Standards-compliant**: Follows official Figma documentation
- **Customizable**: Populates with your values when provided

## Troubleshooting

### Common Issues

#### 1. Missing Environment Variables

**Error**: `Error: Figma file key is required`

**Solution**:

```bash
# Add to .env file
FIGMA_FILE_KEY=your_file_key_here
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

- Check if YAML files exist in input directory
- Verify YAML files have `componentName` and `componentSetId`
- Run `fetchComponents.js` first to generate component data

### Debug Mode

Enable verbose logging by setting environment variable:

```bash
DEBUG=1 node scripts/buildFigmaConfig.js --output console
```

## Best Practices

### 1. Workflow Recommendations

1. **Start with extraction**: Always run `fetchComponents.js` first
2. **Test configuration**: Use `--output console` to preview before generating files
3. **Iterate on settings**: Use command-line options to customize before committing to files
4. **Version control**: Include generated `figma.config.json` in your repository

### 2. Naming Conventions

- **Component names**: Use PascalCase (e.g., `Button`, `CardHeader`)
- **File patterns**: Use glob patterns for include/exclude (e.g., `src/**/*.tsx`)
- **Import paths**: Follow your package structure (e.g., `@my-org/components`)

### 3. Configuration Management

- **Environment files**: Use `.env` for sensitive tokens
- **Command-line options**: Use for project-specific customizations
- **Documentation**: Document your specific configuration choices
