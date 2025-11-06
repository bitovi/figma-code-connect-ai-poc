# Component Props Extraction Script - AI Agent Instructions

## CRITICAL CONTEXT

**Your Role**: Build/enhance `scripts/extractComponentProps.js` - a Node.js script that extracts React component properties from TypeScript files and generates YAML files for Figma Code Connect.

**Project**: Chakra UI component library integration with Figma
**Expected Output**: 150+ YAML files in `components-props/` directory
**Key Innovation**: Integration with Chakra UI recipe system for variant extraction

## SUCCESS CRITERIA (Read This First)

Your script MUST achieve:
- ✅ Find **All** React components in `chakra-ui/apps/compositions/src/ui`
- ✅ Extract ALL props with accurate TypeScript types
- ✅ Scan **All** recipes from `chakra-ui/packages/react/src/theme/recipes`
- ✅ Generate valid YAML matching exact structure below
- ✅ Handle errors gracefully (continue on individual failures)
- ✅ Provide `--verbose`, `--dry-run`, `--filter`, `--overwrite` CLI options

## BEFORE YOU BEGIN

<reasoning_checklist>
1. Does `scripts/extractComponentProps.js` already exist?
   - YES → Analyze it, then enhance with missing features
   - NO → Build from scratch following this spec
2. Are dependencies installed? (`@typescript-eslint/typescript-estree`, `yaml`, `fs-extra`, `glob`)
3. Do the input directories exist?
   - `chakra-ui/apps/compositions/src/ui`
   - `chakra-ui/packages/react/src/theme/recipes`
4. Have you reviewed the example outputs below?
</reasoning_checklist>

## EXACT OUTPUT FORMAT (Template)

**Study these examples carefully - your output MUST match exactly:**

### Example 1: Component with Recipe Variants (button.yaml)

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

### Example 2: Re-export Component (checkboxcardindicator.yaml)

```yaml
componentName: "CheckboxCardIndicator"
filePath: "chakra-ui/apps/compositions/src/ui/checkbox-card.tsx"
relativePath: "./chakra-ui/apps/compositions/src/ui/checkbox-card.tsx"
exportType: "re-export"
exportName: "CheckboxCardIndicator"
interfaceName: null
extendsInterface: null
description: "Re-export from @chakra-ui/react"
props: []
recipeVariants: []
variantProperties: {}
totalProps: 0
potentialFigmaMapping: {}
```

### Example 3: Simple Component (accordionitemtrigger.yaml)

```yaml
componentName: "AccordionItemTrigger"
filePath: "chakra-ui/apps/compositions/src/ui/accordion.tsx"
relativePath: "./chakra-ui/apps/compositions/src/ui/accordion.tsx"
exportType: "forwardRef"
exportName: "AccordionItemTrigger"
interfaceName: "AccordionItemTriggerProps"
extendsInterface: "Accordion.ItemTriggerProps"
description: ""
props:
  - name: "indicatorPlacement"
    type: '"start" | "end"'
    required: false
    defaultValue: '"end"'
    description: ""
    category: "layout"
    unionValues: ["start", "end"]
recipeVariants: []
variantProperties:
  indicatorPlacement: ["start", "end"]
totalProps: 1
potentialFigmaMapping:
  indicatorPlacement: "figma.enum"
```

## STEP-BY-STEP IMPLEMENTATION

### STEP 1: Setup and Dependencies

```javascript
// Required imports
const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');
const yaml = require('yaml');
const { parse } = require('@typescript-eslint/typescript-estree');

// Configuration
const DEFAULT_CONFIG = {
  input: 'chakra-ui/apps/compositions/src/ui',
  output: 'components-props',
  recipesPath: 'chakra-ui/packages/react/src/theme/recipes',
  dryRun: false,
  verbose: false,
  overwrite: false,
  filter: null
};
```

<validation_checkpoint>
✓ Have you parsed CLI arguments correctly?
✓ Do paths resolve from project root?
✓ Are all dependencies imported?
</validation_checkpoint>

### STEP 2: Build Core Functions (In Order)

#### Function 1: `scanDirectory(inputPath)`

**Purpose**: Find all TypeScript files to process

```javascript
function scanDirectory(inputPath) {
  const pattern = path.join(inputPath, '**/*.{ts,tsx}');
  const files = glob.sync(pattern, { absolute: true });
  return files.filter(f => !f.includes('.test.') && !f.includes('.spec.'));
}
```

<validation_checkpoint>
✓ Returns array of absolute file paths?
✓ Filters out test files?
✓ Handles recursive directory scanning?
</validation_checkpoint>

#### Function 2: `scanRecipeDirectory(recipesPath)`

**Purpose**: Extract recipe variant definitions from Chakra UI theme

```javascript
function scanRecipeDirectory(recipesPath) {
  const recipeMap = new Map();
  const recipeFiles = glob.sync(path.join(recipesPath, '**/*.{ts,tsx}'));
  
  for (const file of recipeFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const ast = parse(content, { loc: true, range: true });
    
    // Find defineRecipe() calls
    // Extract recipe name and variants object
    // Store in recipeMap: Map<recipeName, variants>
  }
  
  return recipeMap;
}
```

**What to extract**:
- Recipe name (from variable or export)
- Variants object with keys and values
- Example: `{ size: ["sm", "md", "lg"], variant: ["solid", "outline"] }`

<validation_checkpoint>
✓ Finds all recipe files?
✓ Parses defineRecipe() correctly?
✓ Returns Map with recipe name → variants?
✓ Logs "Found X recipe definitions"?
</validation_checkpoint>

#### Function 3: `parseComponent(filePath, recipeMap)`

**Purpose**: Extract component metadata and props from a single file

**Detection Patterns**:
1. `export const Name = React.forwardRef(...)` → exportType: "forwardRef"
2. `export const Name = forwardRef(...)` → exportType: "forwardRef"
3. `export function Name(...)` → exportType: "function"
4. `export const Name = OtherComponent` → exportType: "re-export"

**What to extract**:
- Component name
- Export type
- Interface/type name (e.g., `ButtonProps`)
- Extended interfaces (e.g., `HTMLChakraProps<...>`)

<validation_checkpoint>
✓ Can parse all 4 export patterns?
✓ Handles multiple components per file?
✓ Returns array of component objects?
</validation_checkpoint>

#### Function 4: `extractPropsFromInterface(interfaceNode, recipeMap)`

**Purpose**: Extract props from TypeScript interface AST

**Key Logic**:
1. Parse interface members
2. For each property:
   - Extract name, type, required flag
   - Detect union types: `"sm" | "md" | "lg"` → unionValues: ["sm", "md", "lg"]
   - Check for default values in JSDoc or assignments
3. Detect `extends RecipeProps<"recipeName">`:
   - Look up recipeName in recipeMap
   - Add recipe variants to output
4. Classify each prop using `classifyProp()`

```javascript
function extractPropsFromInterface(interfaceNode, recipeMap) {
  const props = [];
  const recipeVariants = [];
  
  // Extract regular props
  for (const member of interfaceNode.body.body) {
    props.push({
      name: member.key.name,
      type: getTypeString(member.typeAnnotation),
      required: !member.optional,
      defaultValue: extractDefault(member),
      description: extractJSDoc(member),
      category: classifyProp(member.key.name, member.typeAnnotation),
      unionValues: extractUnionValues(member.typeAnnotation)
    });
  }
  
  // Check for RecipeProps inheritance
  if (interfaceNode.extends) {
    for (const parent of interfaceNode.extends) {
      if (isRecipePropsReference(parent)) {
        const recipeName = extractRecipeName(parent);
        const variants = recipeMap.get(recipeName);
        if (variants) {
          // Convert recipe variants to prop format
          recipeVariants.push(...convertRecipeToProps(variants));
        }
      }
    }
  }
  
  return { props, recipeVariants };
}
```

<validation_checkpoint>
✓ Extracts all property names?
✓ Correctly identifies optional props?
✓ Extracts union values?
✓ Resolves RecipeProps inheritance?
✓ Returns both props and recipeVariants?
</validation_checkpoint>

#### Function 5: `classifyProp(propName, propType)`

**Purpose**: Categorize props for better organization

```javascript
const PROP_CATEGORIES = {
  content: ['children', 'label', 'text', 'placeholder', 'value', 'title'],
  style: ['className', 'style', 'color', 'bg', 'backgroundColor', 'css'],
  behavior: ['onClick', 'onChange', 'onHover', 'disabled', 'loading', 'readOnly'],
  layout: ['width', 'height', 'margin', 'padding', 'flex', 'display'],
  variant: ['variant', 'size', 'colorScheme', 'theme']
};

function classifyProp(propName, propType) {
  for (const [category, patterns] of Object.entries(PROP_CATEGORIES)) {
    if (patterns.some(p => propName.toLowerCase().includes(p.toLowerCase()))) {
      return category;
    }
  }
  return 'other';
}
```

#### Function 6: `generateFigmaMapping(props, recipeVariants)`

**Purpose**: Suggest Figma Code Connect mapping types

```javascript
function generateFigmaMapping(props, recipeVariants) {
  const mapping = {};
  
  const allProps = [...props, ...recipeVariants];
  
  for (const prop of allProps) {
    if (prop.unionValues.length > 0) {
      mapping[prop.name] = 'figma.enum';
    } else if (prop.type === 'boolean') {
      mapping[prop.name] = 'figma.boolean';
    } else if (['string', 'text'].some(t => prop.type.includes(t))) {
      mapping[prop.name] = 'figma.string';
    } else if (prop.name.toLowerCase().includes('icon')) {
      mapping[prop.name] = 'figma.instance';
    }
  }
  
  return mapping;
}
```

#### Function 7: `generateYAML(componentData)`

**Purpose**: Create exact YAML structure

```javascript
function generateYAML(componentData) {
  const { component, props, recipeVariants } = componentData;
  
  // Build variantProperties from all props with unionValues
  const variantProperties = {};
  for (const prop of [...props, ...recipeVariants]) {
    if (prop.unionValues.length > 0) {
      variantProperties[prop.name] = prop.unionValues;
    }
  }
  
  const output = {
    componentName: component.name,
    filePath: component.filePath,
    relativePath: `./${path.relative(process.cwd(), component.filePath)}`,
    exportType: component.exportType,
    exportName: component.exportName,
    interfaceName: component.interfaceName,
    extendsInterface: component.extendsInterface,
    description: component.description || "",
    props: props,
    recipeVariants: recipeVariants,
    variantProperties: variantProperties,
    totalProps: props.length + recipeVariants.length,
    potentialFigmaMapping: generateFigmaMapping(props, recipeVariants)
  };
  
  return yaml.stringify(output);
}
```

<validation_checkpoint>
✓ All required fields present?
✓ Structure matches examples exactly?
✓ variantProperties includes both props and recipes?
✓ totalProps calculation correct?
</validation_checkpoint>

### STEP 3: Main Execution Flow

```javascript
async function main() {
  // 1. Parse CLI arguments
  const config = parseArguments();
  
  // 2. Scan recipe directory FIRST
  console.log('🍳 Scanning for recipe definitions...');
  const recipeMap = scanRecipeDirectory(config.recipesPath);
  console.log(`📚 Found ${recipeMap.size} recipe definitions`);
  
  // 3. Scan component directory
  console.log('🔍 Scanning for React components...');
  const files = scanDirectory(config.input);
  console.log(`📁 Found ${files.length} TypeScript files`);
  
  // 4. Process each file
  const results = [];
  for (const file of files) {
    try {
      const components = parseComponent(file, recipeMap);
      
      for (const component of components) {
        // Apply filter if specified
        if (config.filter && !component.name.toLowerCase().includes(config.filter.toLowerCase())) {
          continue;
        }
        
        const { props, recipeVariants } = extractPropsFromInterface(component.interface, recipeMap);
        
        const componentData = {
          component,
          props,
          recipeVariants
        };
        
        const yamlContent = generateYAML(componentData);
        
        if (!config.dryRun) {
          const outputPath = path.join(config.output, `${component.name.toLowerCase()}.yaml`);
          
          if (!config.overwrite && fs.existsSync(outputPath)) {
            if (config.verbose) console.log(`⏭️  Skipping ${component.name} (exists)`);
            continue;
          }
          
          await fs.ensureDir(config.output);
          await fs.writeFile(outputPath, yamlContent);
          
          if (config.verbose) console.log(`✅ ${component.name} → ${outputPath}`);
        }
        
        results.push(componentData);
      }
    } catch (error) {
      console.warn(`⚠️  Error processing ${file}: ${error.message}`);
      // Continue processing other files
    }
  }
  
  // 5. Summary
  console.log('\n📊 Extraction Summary:');
  console.log(`   Files processed: ${files.length}`);
  console.log(`   Components found: ${results.length}`);
  console.log(`   YAML files written: ${config.dryRun ? 0 : results.length}`);
  console.log(`   Recipe variants extracted: ${recipeMap.size} recipes`);
  console.log(`\n✨ Component props extracted to ${config.output}/ directory`);
}
```

## SELF-TESTING CHECKLIST

After implementation, run these tests:

```bash
# Test 1: Dry run with verbose
node scripts/extractComponentProps.js --dry-run --verbose

# Test 2: Filter specific component
node scripts/extractComponentProps.js --filter accordion --verbose

# Test 3: Check empty re-exports are correct
node scripts/extractComponentProps.js --filter checkboxcardindicator --verbose
# Expected: 0 props (this is CORRECT for re-exports)

# Test 4: Verify recipe integration
node scripts/extractComponentProps.js --filter button --verbose
# Expected: recipeVariants with size and variant from theme/recipes/button.ts

# Test 5: Full extraction
node scripts/extractComponentProps.js --overwrite --verbose
# Expected: 150+ YAML files in components-props/
```

## EDGE CASES YOU MUST HANDLE

### 1. Multiple Components Per File ✓
```typescript
// accordion.tsx exports 4 components
export const AccordionRoot = Accordion.Root;  // Re-export → 0 props
export const AccordionItem = Accordion.Item;   // Re-export → 0 props
export const AccordionItemTrigger = forwardRef(...); // Has props
export const AccordionItemContent = forwardRef(...);  // Has props
```
**Solution**: Create 4 separate YAML files

### 2. Inherited External Props ✓
```typescript
interface Props extends Accordion.ItemContentProps {}
```
**Solution**: Record the inheritance, DON'T try to resolve external types

### 3. Generic Types ✓
```typescript
interface Props<T = string> { value: T; }
```
**Solution**: Record as-is: `type: "T"`, note default if present

### 4. Complex Function Types ✓
```typescript
onSelect: (value: string) => void
```
**Solution**: Simplify to `type: "function"`

### 5. Recipe Not Found ✓
```typescript
interface ButtonProps extends RecipeProps<"button"> {}
// But button.ts doesn't exist in recipes/
```
**Solution**: Log warning, continue with 0 recipe variants

## COMMON MISTAKES TO AVOID

❌ **Don't** try to resolve external dependencies (e.g., `@chakra-ui/react`)
✅ **Do** record the inheritance chain and move on

❌ **Don't** fail entire script if one file has parse errors
✅ **Do** log warning and continue processing

❌ **Don't** assume empty props means error
✅ **Do** recognize re-exports correctly have 0 props

❌ **Don't** overwrite files by default
✅ **Do** require `--overwrite` flag

❌ **Don't** use relative paths for scanning
✅ **Do** use absolute paths, convert to relative for output

## FINAL VALIDATION

Before completing, verify:

- [ ] Script runs without crashes
- [ ] 150+ YAML files generated in `components-props/`
- [ ] All YAML files match exact structure from examples
- [ ] Recipe variants included where applicable (17 recipes expected)
- [ ] Empty files exist for re-exports (this is CORRECT)
- [ ] CLI options all work (`--verbose`, `--dry-run`, `--filter`, `--overwrite`)
- [ ] Error handling: script continues on individual file failures
- [ ] Summary output shows counts and success message

## DEPENDENCIES

```json
{
  "@typescript-eslint/typescript-estree": "^6.0.0",
  "yaml": "^2.3.0",
  "fs-extra": "^11.0.0",
  "glob": "^8.1.0"
}
```

---

**Remember**: This script is Phase 2 of a 3-phase pipeline. Your output will be used by a future Code Connect generation script. Accuracy is critical.
