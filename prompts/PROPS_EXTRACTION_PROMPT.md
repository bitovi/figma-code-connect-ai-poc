# AI Agent Task: Component Props Extraction Script

## 🎯 Your Mission

You are an AI agent tasked with building a Node.js script called `extractComponentProps.js` that extracts React component properties and metadata from TypeScript files to generate YAML files for Figma Code Connect integration.

**If the script already exists, analyze it and enhance it with the requirements below.**

## 📋 What You Must Build/Analyze

### Core Script Requirements

Create or enhance `scripts/extractComponentProps.js` with these capabilities:

1. **Scan React Components**: Parse TypeScript files to find React components
2. **Extract Props**: Analyze component interfaces to extract all properties  
3. **Recipe Integration**: Scan Chakra UI recipe system for variant definitions
4. **Generate YAML**: Output structured data for Figma Code Connect
5. **CLI Interface**: Provide command-line interface with options

## 🔍 Analysis Tasks

If examining existing code, verify these functionalities:

### 1. Component Detection
**Check if the script can identify:**
- `export const ComponentName = React.forwardRef(...)`
- `export const ComponentName = forwardRef(...)`  
- `export function ComponentName(...)`
- Interface definitions: `interface ComponentNameProps extends ...`
- Type aliases: `type ComponentNameProps = ...`
- Re-exports: `export const Component = BaseComponent`

### 2. Recipe System Integration  
**Verify if the script can:**
- Scan `chakra-ui/packages/react/src/theme/recipes/` directory
- Parse `defineRecipe()` calls to extract variant definitions
- Resolve `RecipeProps<"componentName">` inheritance patterns
- Link component interfaces to recipe variants

### 3. Props Extraction
**Ensure the script extracts:**
- Property names and TypeScript types
- Optional vs required properties
- Union types for variant values
- Default values where available
- JSDoc comments for descriptions

## Directory Structure

```
./figma-code-connect-ai-poc/
├── scripts/
│   ├── extractComponentProps.js        # IMPLEMENTED - Enhanced with recipe scanning
│   ├── fetchComponents.js              # Existing Figma API script
│   └── buildFigmaConfig.js            # Existing config builder
├── chakra-ui/apps/compositions/src/ui/ # INPUT: Scan this directory
├── chakra-ui/packages/react/src/theme/recipes/ # NEW INPUT: Recipe variants scanning
├── components-props/                   # OUTPUT: Generated YAML files (150+ files generated)
└── figma-variants/                     # REFERENCE: Figma variant data
```

## Input Requirements

### Target Directories

- **Primary Scan**: `chakra-ui/apps/compositions/src/ui` (recursive)
- **Recipe Scan**: `chakra-ui/packages/react/src/theme/recipes` (NEW - extracts variant definitions)
- **File Types**: `.tsx`, `.ts` files containing React components
- **Relative Paths**: All paths relative to project root

### Component Detection Patterns

1. `export const ComponentName = React.forwardRef(...)`
2. `export const ComponentName = forwardRef(...)`
3. `export function ComponentName(...)`
4. `interface ComponentNameProps extends ...`
5. `type ComponentNameProps = ...`
6. Re-exports: `export const Component = BaseComponent`
7. **NEW**: Recipe variant inheritance via `RecipeProps<"componentName">`

### Recipe System Integration

The script now scans Chakra UI's recipe system to extract variant properties:
```typescript
// Detects this inheritance pattern:
interface ButtonBaseProps extends RecipeProps<"button"> {} 
interface ButtonProps extends HTMLChakraProps<"button", ButtonBaseProps> {}

// And resolves to actual recipe variants:
// chakra-ui/packages/react/src/theme/recipes/button.ts
export const buttonRecipe = defineRecipe({
  variants: {
    size: { "2xs": {...}, xs: {...}, sm: {...}, md: {...}, lg: {...}, xl: {...}, "2xl": {...} },
    variant: { solid: {...}, subtle: {...}, surface: {...}, outline: {...}, ghost: {...}, plain: {...} }
  }
})
```

## Output Requirements

### Output Directory
- **Location**: `components-props/` (at project root)
- **Format**: YAML files (one per component)
- **Naming**: `{componentName}.yaml` (lowercase)

### YAML Structure

**Current Output Structure** (Enhanced with recipe variants):
```yaml
# Example: components-props/button.yaml (if Button component existed in scan path)
componentName: "Button"
filePath: "chakra-ui/packages/react/src/components/button/button.tsx"
relativePath: "./chakra-ui/packages/react/src/components/button/button.tsx"
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
recipeVariants:  # NEW: Recipe variants from chakra-ui/packages/react/src/theme/recipes/
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
totalProps: 3  # Includes props + recipeVariants
potentialFigmaMapping:
  size: "figma.enum"
  variant: "figma.enum" 
  loading: "figma.boolean"
```

## Technical Implementation

### Enhanced Recipe System Integration

The script now includes sophisticated recipe scanning:

1. **Recipe Directory Scanning**: `scanRecipeDirectory(recipesPath)`
   - Scans `chakra-ui/packages/react/src/theme/recipes/**/*.{ts,tsx}`
   - Parses `defineRecipe()` calls to extract variant definitions
   - Found: 17 recipe definitions (button, input, badge, etc.)

2. **Recipe Variant Resolution**: `extractRecipeVariants(recipeNode)`
   - Parses AST to extract variant objects from recipe definitions
   - Handles complex nested variant structures
   - Maps variant keys to union value arrays

3. **RecipeProps Inheritance**: Enhanced `extractPropsFromInterface()`
   - Detects `extends RecipeProps<"componentName">` patterns
   - Resolves recipe references to actual variant definitions
   - Handles inheritance chains: `ButtonProps → ButtonBaseProps → RecipeProps<"button">`

### Current Recipe Coverage

```
Recipe variants successfully extracted:
- button: size, variant (6 variants, 7 sizes)
- badge: variant, size
- input: size, variant  
- kbd: variant, size
- link: variant
- spinner: size
- textarea: size, variant
- separator: variant, orientation, size
- And 9 more recipes...
```

### Dependencies

```json
{
  "@typescript-eslint/typescript-estree": "^6.0.0",
  "yaml": "^2.3.0",
  "fs-extra": "^11.0.0",
  "glob": "^8.1.0"
}
```

### TypeScript AST Parsing Strategy

1. **Parse Files**: Use `@typescript-eslint/typescript-estree` to parse TypeScript
2. **Extract Interfaces**: Find all interface/type definitions
3. **Extract Components**: Find React component exports
4. **Resolve Inheritance**: Follow `extends` chains for complete prop lists
5. **Infer Types**: Extract union types, optional markers, default values

### Prop Classification System

```javascript
const PROP_CATEGORIES = {
  content: ['children', 'label', 'text', 'placeholder', 'value'],
  style: ['className', 'style', 'color', 'bg', 'backgroundColor'],
  behavior: ['onClick', 'onHover', 'disabled', 'loading', 'readOnly'],
  layout: ['size', 'width', 'height', 'margin', 'padding', 'flex'],
  variant: ['variant', 'size', 'colorScheme', 'theme']
};
```

### Figma Mapping Suggestions

```javascript
const FIGMA_MAPPING_HINTS = {
  // String mappings
  string: ['children', 'label', 'text', 'placeholder', 'aria-label'],
  // Boolean mappings
  boolean: ['disabled', 'loading', 'readOnly', 'isOpen', 'isActive'],
  // Enum mappings (look for union types)
  enum: ['variant', 'size', 'colorScheme', 'placement', 'orientation'],
  // className helper
  className: ['className', 'class'],
  // Instance mappings
  instance: ['icon', 'startIcon', 'endIcon', 'avatar']
};
```

## 🎯 Edge Cases to Handle

### 1. Multiple Components Per File

```typescript
// accordion.tsx contains:
// - AccordionItemTrigger
// - AccordionItemContent
// - AccordionRoot (re-export)
// - AccordionItem (re-export)
```
**Solution**: Create separate YAML files for each component

### 2. Inherited Props

```typescript
interface AccordionItemContentProps extends Accordion.ItemContentProps {}
```
**Solution**: 
- Record the inheritance chain
- Don't resolve external dependencies (Chakra internals)
- Focus on props defined in the current file

### 3. Generic Props

```typescript
interface ComponentProps<T = string> {
  value: T;
}
```
**Solution**: Record generics as-is, infer default types when possible

### 4. Union Type Variants

```typescript
interface ButtonProps {
  variant?: "solid" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
}
```
**Solution**: Extract union options for variantProperties

### 5. Complex Types

```typescript
interface Props {
  onSelect: (value: string) => void;
  render: (props: RenderProps) => ReactNode;
}
```
**Solution**: Simplify to basic type categories (function, ReactNode)

## 📝 Command Line Interface

### Current Usage

```bash
# Extract all components (default paths)
node scripts/extractComponentProps.js

# Extract with recipe scanning and verbose output
node scripts/extractComponentProps.js --verbose

# Filter specific components
node scripts/extractComponentProps.js --filter button --verbose

# Dry run to preview output
node scripts/extractComponentProps.js --dry-run --verbose

# Overwrite existing files
node scripts/extractComponentProps.js --overwrite

# Custom paths (advanced)
node scripts/extractComponentProps.js \
  --input "chakra-ui/apps/compositions/src/ui" \
  --output "components-props" \
  --verbose

# Help
node scripts/extractComponentProps.js --help
```

### CLI Options

```javascript
const DEFAULT_CONFIG = {
  input: 'chakra-ui/apps/compositions/src/ui',    // Component scan directory
  output: 'components-props',                      // Output directory  
  recipesPath: 'chakra-ui/packages/react/src/theme/recipes', // NEW: Recipe variants
  dryRun: false,                                   // Preview without writing
  verbose: false,                                  // Detailed logging
  overwrite: false,                                // Overwrite existing files
  filter: null                                     // Component name filter
};
```

### Current Performance

```
� Scanning for React components...

🍳 Scanning for recipe definitions...
📚 Found 17 recipe definitions
📁 Found 55 TypeScript files in chakra-ui/apps/compositions/src/ui

📊 Extraction Summary:
   Files processed: 55
   Components found: 150+
   YAML files written: 150+
   Recipe variants extracted: 17 recipes with 40+ total variants

✨ Component props extracted to components-props/ directory
```

## Your Success Criteria

When your script is complete, it MUST achieve these outcomes:

### 1. Component Detection Requirements

YOU MUST:
- Scan and find ALL React components in `chakra-ui/apps/compositions/src/ui` (150+ expected)
- Detect these patterns: `forwardRef`, function exports, const exports
- Handle re-exported components (these will have 0 props - this is correct)
- Process files recursively through all subdirectories

### 2. Props Extraction Requirements  

YOU MUST:
- Extract ALL props from TypeScript interfaces and types
- Capture exact TypeScript types (including union types: `"sm" | "md" | "lg"`)
- Identify optional props (marked with `?`) vs required props
- Classify each prop into categories: content, style, behavior, layout, variant
- Extract recipe variants from Chakra UI's theme system (NEW REQUIREMENT)

### 3. Recipe System Integration Requirements

YOU MUST:
- Scan `chakra-ui/packages/react/src/theme/recipes/**/*.{ts,tsx}`
- Parse `defineRecipe()` calls to extract variant definitions  
- Resolve `RecipeProps<"componentName">` inheritance patterns
- Map recipe variants to actual union value arrays
- Include recipe variants in final YAML output with `source: "recipe"`

### 4. Output Generation Requirements

YOU MUST:
- Generate one YAML file per component in `components-props/`
- Use exact YAML structure shown in examples above
- Include both regular props AND recipe variants
- Generate `variantProperties` object with all union values
- Suggest appropriate `potentialFigmaMapping` based on prop types

### 5. Error Handling Requirements

YOU MUST:
- Continue processing if individual files fail to parse
- Log warnings for unparseable files but don't crash
- Handle missing recipe files gracefully
- Provide clear error messages with file paths

## Your Implementation Tasks

### Build the CLI Interface

YOU MUST build a command-line script that accepts these arguments:

```bash
# Your script MUST support all these usage patterns:
node scripts/extractComponentProps.js                    # Default: scan all components
node scripts/extractComponentProps.js --verbose          # With detailed logging  
node scripts/extractComponentProps.js --filter button    # Specific component only
node scripts/extractComponentProps.js --dry-run          # Preview without writing files
node scripts/extractComponentProps.js --overwrite        # Replace existing YAML files
```

### Build These Core Functions

YOU MUST implement these exact functions:

1. **`scanDirectory(inputPath)`** 
   - Find all `.tsx` and `.ts` files recursively
   - Return array of file paths to process

2. **`scanRecipeDirectory(recipesPath)`** 
   - NEW: Scan recipe files for variant definitions
   - Parse `defineRecipe()` calls from AST
   - Return map of recipe name to variant definitions

3. **`parseComponent(filePath)`**
   - Use `@typescript-eslint/typescript-estree` to parse TypeScript
   - Extract component exports and their interface/type definitions
   - Handle multiple components per file

4. **`extractProps(interfaceNode)`**
   - Extract props from TypeScript interface AST nodes
   - Resolve `extends` inheritance chains  
   - Detect and resolve `RecipeProps<"componentName">` patterns
   - Return structured prop data with types and metadata

5. **`extractRecipeVariants(recipeNode)`**
   - NEW: Parse recipe variant objects from AST
   - Extract variant keys and their union value arrays
   - Return variant definitions for props inheritance

6. **`classifyProp(propName, propType)`**
   - Categorize props: content, style, behavior, layout, variant
   - Generate Figma mapping suggestions based on type patterns

7. **`generateYAML(componentData)`**
   - Build exact YAML structure matching examples
   - Include both regular props AND recipe variants
   - Generate `variantProperties` and `potentialFigmaMapping` sections

8. **`writeComponentFile(componentName, yamlData)`**
   - Write YAML files to `components-props/` directory
   - Handle file naming (lowercase component names)
   - Implement `--overwrite` and `--dry-run` logic

### Test Your Implementation

YOU MUST verify your script works by testing:

1. **Run on accordion components**: `node scripts/extractComponentProps.js --filter accordion --verbose`
2. **Verify empty files are correct**: Components like `CheckboxCardIndicator` should have 0 props (re-exports)
3. **Check recipe integration**: Button components should include recipe variants from theme system
4. **Validate YAML structure**: Output must match examples exactly
5. **Test error handling**: Script continues processing when individual files fail

## Integration Context

### What Already Exists

- **Phase 1**: `figma-variants/` directory contains Figma-extracted variant data
- **Existing Scripts**: `fetchComponents.js`, `buildFigmaConfig.js` 
- **Target Components**: 150+ components in `chakra-ui/apps/compositions/src/ui`
- **Recipe System**: 17 recipes in `chakra-ui/packages/react/src/theme/recipes`

### What You're Building

- **Phase 2**: Enhanced props extraction script with recipe scanning
- **Output**: `components-props/` directory with 150+ YAML files
- **Enhancement**: Recipe variant integration for complete prop coverage

### What Comes Next

- **Phase 3**: Code Connect generation script (future) 
- **Goal**: Generate `.figma.tsx` files using both phases 1 & 2 data

Build this script to be production-ready with robust error handling, clear logging, and the exact YAML output structure shown in the examples above.
