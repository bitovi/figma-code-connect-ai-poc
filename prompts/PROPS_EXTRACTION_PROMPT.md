# Component Props Extraction Script - Complete Specification

## 🎯 Project Goal
Create a Node.js script called `extractComponentProps.js` that extracts React component properties and metadata from TypeScript files to generate YAML files compatible with Figma Code Connect integration.

## 📁 Directory Structure
```
/Users/michel/GitHub/figma-code-connect-ai-poc/
├── scripts/
│   ├── extractComponentProps.js        # NEW SCRIPT TO CREATE
│   ├── fetchComponents.js              # Existing Figma API script
│   └── buildFigmaConfig.js            # Existing config builder
├── chakra-ui/apps/compositions/src/ui/ # INPUT: Scan this directory
├── components-props/                   # OUTPUT: Generated YAML files
└── figma-variants/                     # REFERENCE: Figma variant data
```

## 🔍 Input Requirements

### Target Directory
- **Scan**: `chakra-ui/apps/compositions/src/ui` (recursive)
- **File Types**: `.tsx`, `.ts` files containing React components
- **Relative Paths**: All paths relative to project root

### Component Detection Patterns
1. `export const ComponentName = React.forwardRef(...)`
2. `export const ComponentName = forwardRef(...)`
3. `export function ComponentName(...)`
4. `interface ComponentNameProps extends ...`
5. `type ComponentNameProps = ...`
6. Re-exports: `export { Component } from "./path"`

## 📋 Output Requirements

### Output Directory
- **Location**: `components-props/` (at project root)
- **Format**: YAML files (one per component)
- **Naming**: `{componentName}.yaml` (lowercase)

### YAML Structure (Based on Figma Variants Pattern)
```yaml
# Example: components-props/accordionitemcontent.yaml
componentName: "AccordionItemContent"
filePath: "chakra-ui/apps/compositions/src/ui/accordion.tsx"
relativePath: "./chakra-ui/apps/compositions/src/ui/accordion.tsx"
exportType: "forwardRef" # or "function", "const", "reexport"
exportName: "AccordionItemContent"
interfaceName: "AccordionItemContentProps"
extendsInterface: "Accordion.ItemContentProps"
description: "" # From JSDoc if available
props:
  - name: "children"
    type: "React.ReactNode"
    required: false
    defaultValue: null
    description: ""
    category: "content" # content, style, behavior, layout
  - name: "className"
    type: "string"
    required: false
    defaultValue: null
    description: ""
    category: "style"
variantProperties: # Map common props that match Figma patterns
  size: []      # Extract from union types like "sm" | "md" | "lg"
  variant: []   # Extract from union types like "solid" | "outline"
  color: []     # Extract color-related union types
totalProps: 2
potentialFigmaMapping: # Suggest mappings based on prop names
  size: "figma.enum"
  variant: "figma.enum"
  children: "figma.string"
  className: "figma.className"
```

## 🛠 Technical Implementation

### Dependencies (Already Installed)
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

### Basic Usage
```bash
# Extract all components
node scripts/extractComponentProps.js

# With custom options
node scripts/extractComponentProps.js \
  --input "chakra-ui/apps/compositions/src/ui" \
  --output "components-props" \
  --dry-run

# Help
node scripts/extractComponentProps.js --help
```

### CLI Options
```javascript
const options = {
  input: 'chakra-ui/apps/compositions/src/ui',    // Scan directory
  output: 'components-props',                      // Output directory  
  dryRun: false,                                   // Preview without writing
  verbose: false,                                  // Detailed logging
  overwrite: false,                                // Overwrite existing files
  filter: null                                     // Component name filter
};
```

## 📊 Success Criteria

### 1. Accurate Component Detection
- ✅ Find all React components in target directory
- ✅ Handle forwardRef, function, and const patterns
- ✅ Detect re-exported components

### 2. Complete Props Extraction  
- ✅ Extract all props from interfaces/types
- ✅ Capture TypeScript types accurately
- ✅ Handle optional props and default values
- ✅ Classify props by category (content, style, behavior, etc.)

### 3. Figma Integration Ready
- ✅ Generate YAML structure matching figma-variants pattern
- ✅ Suggest appropriate Figma Code Connect mappings
- ✅ Extract variant properties from union types
- ✅ Prepare for phase 3 (Code Connect generation)

### 4. Robust Error Handling
- ✅ Handle malformed TypeScript files
- ✅ Skip files that can't be parsed
- ✅ Log detailed error messages
- ✅ Continue processing on individual failures

### 5. Developer Experience
- ✅ Clear progress logging with component counts
- ✅ Dry-run mode for testing
- ✅ Helpful CLI with examples
- ✅ Integration with existing npm scripts

## 🔗 Integration Points

### Phase 1: Current (Figma Variants)
```yaml
# figma-variants/accordion.yaml
componentName: "Accordion"
variantProperties:
  size: [lg, md, sm]
  variant: [enclosed, outline, plain, subtle]
```

### Phase 2: Props Extraction (This Script)
```yaml
# components-props/accordion.yaml  
componentName: "Accordion"
props:
  - name: "size"
    type: "sm" | "md" | "lg"
  - name: "variant" 
    type: "enclosed" | "outline" | "plain" | "subtle"
variantProperties:
  size: [sm, md, lg]
  variant: [enclosed, outline, plain, subtle]
```

### Phase 3: Code Connect Generation (Future)
```javascript
// accordion.figma.tsx (to be generated)
figma.connect(Accordion, "https://figma.com/...", {
  props: {
    size: figma.enum("size", {
      sm: "sm", md: "md", lg: "lg"
    }),
    variant: figma.enum("variant", {
      enclosed: "enclosed",
      outline: "outline", 
      plain: "plain",
      subtle: "subtle"
    })
  },
  example: ({ size, variant }) => (
    <Accordion size={size} variant={variant}>
      {/* ... */}
    </Accordion>
  )
});
```

## 📋 Implementation Checklist

### Script Structure
- [ ] CLI argument parsing with `process.argv`
- [ ] File system operations with `fs-extra`
- [ ] Directory scanning with `glob`
- [ ] TypeScript parsing with `@typescript-eslint/typescript-estree`
- [ ] YAML generation with `yaml`

### Core Functions
- [ ] `scanDirectory(inputPath)` - Find all .tsx/.ts files
- [ ] `parseComponent(filePath)` - Extract component info from file
- [ ] `extractProps(interfaceNode)` - Get props from interface AST
- [ ] `classifyProp(propName, propType)` - Categorize prop
- [ ] `generateYAML(componentData)` - Create YAML structure
- [ ] `writeComponentFile(componentName, yamlData)` - Save to disk

### Validation & Testing
- [ ] Test with accordion.tsx (known structure)
- [ ] Verify prop extraction accuracy
- [ ] Check union type handling
- [ ] Validate YAML output format
- [ ] Test error handling with malformed files

---

## 🚀 Ready to Implement

This specification provides everything needed to build the component props extraction script. The script will bridge the gap between Figma design variants and React component props, enabling automatic generation of Figma Code Connect definitions in phase 3.

**Next Step**: Create `scripts/extractComponentProps.js` following this specification.