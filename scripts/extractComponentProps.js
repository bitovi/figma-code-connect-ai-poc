#!/usr/bin/env node

/**
 * Extract Component Props Script
 * 
 * Scans React TypeScript files to extract component props and metadata,
 * generating YAML files compatible with Figma Code Connect integration.
 * 
 * @author AI Assistant
 * @date 2025-11-06
 */

const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');
const { parse } = require('@typescript-eslint/typescript-estree');
const YAML = require('yaml');

// Configuration
const DEFAULT_CONFIG = {
  input: 'chakra-ui/apps/compositions/src/ui',
  output: 'components-props',
  dryRun: false,
  verbose: false,
  overwrite: false,
  filter: null
};

// Prop classification system
const PROP_CATEGORIES = {
  content: ['children', 'label', 'text', 'placeholder', 'value', 'title', 'description'],
  style: ['className', 'style', 'color', 'bg', 'backgroundColor', 'borderColor', 'shadow'],
  behavior: ['onClick', 'onHover', 'onFocus', 'onBlur', 'disabled', 'loading', 'readOnly'],
  layout: ['size', 'width', 'height', 'margin', 'padding', 'flex', 'position'],
  variant: ['variant', 'size', 'colorScheme', 'theme', 'appearance']
};

// Figma mapping suggestions
const FIGMA_MAPPING_HINTS = {
  string: ['children', 'label', 'text', 'placeholder', 'aria-label', 'title'],
  boolean: ['disabled', 'loading', 'readOnly', 'isOpen', 'isActive', 'isRequired'],
  enum: ['variant', 'size', 'colorScheme', 'placement', 'orientation', 'direction'],
  className: ['className', 'class'],
  instance: ['icon', 'startIcon', 'endIcon', 'avatar', 'leftIcon', 'rightIcon']
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_CONFIG };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--input':
        config.input = nextArg;
        i++;
        break;
      case '--output':
        config.output = nextArg;
        i++;
        break;
      case '--filter':
        config.filter = nextArg;
        i++;
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--verbose':
        config.verbose = true;
        break;
      case '--overwrite':
        config.overwrite = true;
        break;
      case '--help':
        showHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) {
          console.warn(`Unknown option: ${arg}`);
        }
    }
  }
  
  return config;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
📋 Extract Component Props Script

Extract React component properties and metadata for Figma Code Connect integration.

USAGE:
  node scripts/extractComponentProps.js [OPTIONS]

OPTIONS:
  --input <path>     Input directory to scan (default: chakra-ui/apps/compositions/src/ui)
  --output <path>    Output directory for YAML files (default: components-props)
  --filter <name>    Filter by component name (e.g., "Accordion")
  --dry-run          Preview without writing files
  --verbose          Detailed logging
  --overwrite        Overwrite existing files
  --help             Show this help

EXAMPLES:
  # Extract all components
  node scripts/extractComponentProps.js

  # Extract specific component
  node scripts/extractComponentProps.js --filter "Accordion" --verbose

  # Preview without writing
  node scripts/extractComponentProps.js --dry-run

  # Custom input/output directories
  node scripts/extractComponentProps.js --input "src/components" --output "extracted-props"
`);
}

/**
 * Scan directory for TypeScript React files
 */
function scanDirectory(inputPath) {
  const pattern = path.join(inputPath, '**/*.{ts,tsx}');
  const files = glob.sync(pattern, { absolute: true });
  
  return files.filter(file => {
    // Filter out test files, stories, etc.
    const fileName = path.basename(file);
    return !fileName.includes('.test.') && 
           !fileName.includes('.spec.') && 
           !fileName.includes('.stories.');
  });
}

/**
 * Extract component information from a TypeScript file
 */
function parseComponent(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const ast = parse(content, {
      jsx: true,
      useJSXTextNode: true,
      errorOnUnknownASTType: false,
      errorOnTypeScriptSyntacticAndSemanticIssues: false
    });
    
    const components = [];
    const interfaces = new Map();
    
    // Extract interfaces and types first
    ast.body.forEach(node => {
      if (node.type === 'TSInterfaceDeclaration') {
        interfaces.set(node.id.name, node);
        if (process.env.DEBUG) {
          console.log(`🔍 Found interface: ${node.id.name}`);
        }
      } else if (node.type === 'TSTypeAliasDeclaration') {
        interfaces.set(node.id.name, node);
        if (process.env.DEBUG) {
          console.log(`🔍 Found type alias: ${node.id.name}`);
        }
      } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
        // Handle exported interfaces and types
        if (node.declaration.type === 'TSInterfaceDeclaration') {
          interfaces.set(node.declaration.id.name, node.declaration);
          if (process.env.DEBUG) {
            console.log(`🔍 Found exported interface: ${node.declaration.id.name}`);
          }
        } else if (node.declaration.type === 'TSTypeAliasDeclaration') {
          interfaces.set(node.declaration.id.name, node.declaration);
          if (process.env.DEBUG) {
            console.log(`🔍 Found exported type alias: ${node.declaration.id.name}`);
          }
        }
      }
    });
    
    // Extract component exports
    ast.body.forEach(node => {
      const component = extractComponentFromNode(node, interfaces, filePath);
      if (component) {
        components.push(component);
      }
    });
    
    return components;
    
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error.message);
    return [];
  }
}

/**
 * Extract component data from an AST node
 */
function extractComponentFromNode(node, interfaces, filePath) {
  let componentName = null;
  let exportType = null;
  let interfaceName = null;
  
  // Handle different export patterns
  if (node.type === 'ExportNamedDeclaration' && node.declaration) {
    const decl = node.declaration;
    
    if (decl.type === 'VariableDeclaration') {
      // export const ComponentName = ...
      const declarator = decl.declarations[0];
      if (declarator && declarator.id) {
        componentName = declarator.id.name;
        
        // Check if it's a React.forwardRef or forwardRef
        if (declarator.init && 
            (isForwardRefCall(declarator.init) || isFunctionExpression(declarator.init))) {
          exportType = isForwardRefCall(declarator.init) ? 'forwardRef' : 'const';
          interfaceName = `${componentName}Props`;
        }
      }
    } else if (decl.type === 'FunctionDeclaration') {
      // export function ComponentName(...) 
      componentName = decl.id.name;
      exportType = 'function';
      interfaceName = `${componentName}Props`;
    }
  }
  
  // Handle re-exports
  if (node.type === 'ExportNamedDeclaration' && !node.declaration && node.specifiers) {
    node.specifiers.forEach(spec => {
      if (spec.type === 'ExportSpecifier') {
        componentName = spec.exported.name;
        exportType = 'reexport';
        // For re-exports, we don't have local interface info
      }
    });
  }
  
  if (!componentName) return null;
  
  // Extract props if interface exists
  const props = [];
  const variantProperties = {};
  let extendsInterface = null;
  
  if (interfaceName && interfaces.has(interfaceName)) {
    const interfaceNode = interfaces.get(interfaceName);
    
    // Debug logging
    if (process.env.DEBUG) {
      console.log(`\n🐛 Debug - Interface ${interfaceName}:`);
      console.log('  Interface type:', interfaceNode.type);
      console.log('  Has body:', !!interfaceNode.body);
      if (interfaceNode.body) {
        console.log('  Body type:', interfaceNode.body.type);
        console.log('  Has body.body:', !!interfaceNode.body.body);
        if (interfaceNode.body.body) {
          console.log('  Properties count:', interfaceNode.body.body.length);
        }
      }
      console.log('  Has extends:', !!interfaceNode.extends);
    }
    
    const extractedProps = extractPropsFromInterface(interfaceNode);
    props.push(...extractedProps.props);
    Object.assign(variantProperties, extractedProps.variantProperties);
    extendsInterface = extractedProps.extendsInterface;
  }
  
  // Generate relative path
  const relativePath = './' + path.relative(process.cwd(), filePath);
  
  return {
    componentName,
    filePath: path.relative(process.cwd(), filePath),
    relativePath,
    exportType,
    exportName: componentName,
    interfaceName,
    extendsInterface,
    description: "", // TODO: Extract JSDoc comments
    props,
    variantProperties,
    totalProps: props.length,
    potentialFigmaMapping: generateFigmaMapping(props)
  };
}

/**
 * Check if node is a React.forwardRef call
 */
function isForwardRefCall(node) {
  if (node.type === 'CallExpression') {
    if (node.callee.type === 'MemberExpression' &&
        node.callee.object.name === 'React' &&
        node.callee.property.name === 'forwardRef') {
      return true;
    }
    if (node.callee.type === 'Identifier' &&
        node.callee.name === 'forwardRef') {
      return true;
    }
  }
  return false;
}

/**
 * Check if node is a function expression
 */
function isFunctionExpression(node) {
  return node.type === 'FunctionExpression' || 
         node.type === 'ArrowFunctionExpression';
}

/**
 * Extract props from an interface or type node
 */
function extractPropsFromInterface(interfaceNode) {
  const props = [];
  const variantProperties = {};
  let extendsInterface = null;
  
  // Check for extends clause
  if (interfaceNode.extends && interfaceNode.extends.length > 0) {
    const extendedType = interfaceNode.extends[0];
    if (extendedType.expression) {
      extendsInterface = getTypeString(extendedType.expression);
    }
  }
  
  // Extract properties from interface body
  if (interfaceNode.body) {
    // Handle TSInterfaceBody
    const bodyNode = interfaceNode.body;
    if (bodyNode.body && Array.isArray(bodyNode.body)) {
      bodyNode.body.forEach(property => {
        if (property.type === 'TSPropertySignature' && property.key) {
          const prop = extractPropFromProperty(property);
          if (prop) {
            props.push(prop);
            
            // Extract variant properties from union types
            if (prop.unionValues && prop.unionValues.length > 0) {
              variantProperties[prop.name] = prop.unionValues;
            }
          }
        }
      });
    } else if (bodyNode.type === 'TSTypeLiteral' && bodyNode.members) {
      // Handle TSTypeLiteral members
      bodyNode.members.forEach(property => {
        if (property.type === 'TSPropertySignature' && property.key) {
          const prop = extractPropFromProperty(property);
          if (prop) {
            props.push(prop);
            
            // Extract variant properties from union types
            if (prop.unionValues && prop.unionValues.length > 0) {
              variantProperties[prop.name] = prop.unionValues;
            }
          }
        }
      });
    }
  }
  
  // Handle type alias declarations
  if (interfaceNode.type === 'TSTypeAliasDeclaration' && interfaceNode.typeAnnotation) {
    if (interfaceNode.typeAnnotation.type === 'TSTypeLiteral' && interfaceNode.typeAnnotation.members) {
      interfaceNode.typeAnnotation.members.forEach(property => {
        if (property.type === 'TSPropertySignature' && property.key) {
          const prop = extractPropFromProperty(property);
          if (prop) {
            props.push(prop);
            
            // Extract variant properties from union types
            if (prop.unionValues && prop.unionValues.length > 0) {
              variantProperties[prop.name] = prop.unionValues;
            }
          }
        }
      });
    }
  }
  
  return { props, variantProperties, extendsInterface };
}

/**
 * Extract prop information from a property node
 */
function extractPropFromProperty(property) {
  const name = property.key.name;
  const required = !property.optional;
  const typeInfo = extractTypeInfo(property.typeAnnotation);
  
  return {
    name,
    type: typeInfo.type,
    required,
    defaultValue: null, // TODO: Extract default values from destructuring
    description: "", // TODO: Extract JSDoc comments
    category: classifyProp(name),
    unionValues: typeInfo.unionValues
  };
}

/**
 * Extract type information from type annotation
 */
function extractTypeInfo(typeAnnotation) {
  if (!typeAnnotation || !typeAnnotation.typeAnnotation) {
    return { type: 'unknown', unionValues: [] };
  }
  
  const type = typeAnnotation.typeAnnotation;
  
  switch (type.type) {
    case 'TSStringKeyword':
      return { type: 'string', unionValues: [] };
    case 'TSNumberKeyword':
      return { type: 'number', unionValues: [] };
    case 'TSBooleanKeyword':
      return { type: 'boolean', unionValues: [] };
    case 'TSUnionType':
      const unionValues = type.types
        .filter(t => t.type === 'TSLiteralType' && t.literal.type === 'Literal')
        .map(t => t.literal.value);
      const unionType = unionValues.length > 0 ? 
        unionValues.map(v => `"${v}"`).join(' | ') : 
        'union';
      return { type: unionType, unionValues };
    case 'TSTypeReference':
      const typeName = getTypeString(type);
      return { type: typeName, unionValues: [] };
    default:
      return { type: type.type || 'unknown', unionValues: [] };
  }
}

/**
 * Get string representation of a type
 */
function getTypeString(typeNode) {
  if (!typeNode) return 'unknown';
  
  switch (typeNode.type) {
    case 'Identifier':
      return typeNode.name;
    case 'TSQualifiedName':
      return `${getTypeString(typeNode.left)}.${typeNode.right.name}`;
    case 'MemberExpression':
      return `${getTypeString(typeNode.object)}.${typeNode.property.name}`;
    default:
      return typeNode.type || 'unknown';
  }
}

/**
 * Classify prop by category
 */
function classifyProp(propName) {
  for (const [category, keywords] of Object.entries(PROP_CATEGORIES)) {
    if (keywords.some(keyword => propName.toLowerCase().includes(keyword.toLowerCase()))) {
      return category;
    }
  }
  return 'other';
}

/**
 * Generate Figma mapping suggestions
 */
function generateFigmaMapping(props) {
  const mapping = {};
  
  props.forEach(prop => {
    for (const [figmaType, keywords] of Object.entries(FIGMA_MAPPING_HINTS)) {
      if (keywords.includes(prop.name) || 
          (figmaType === 'enum' && prop.unionValues && prop.unionValues.length > 0) ||
          (figmaType === 'boolean' && prop.type === 'boolean')) {
        mapping[prop.name] = `figma.${figmaType}`;
        break;
      }
    }
  });
  
  return mapping;
}

/**
 * Generate YAML structure for a component
 */
function generateComponentYAML(componentData) {
  return {
    componentName: componentData.componentName,
    filePath: componentData.filePath,
    relativePath: componentData.relativePath,
    exportType: componentData.exportType,
    exportName: componentData.exportName,
    interfaceName: componentData.interfaceName || "",
    extendsInterface: componentData.extendsInterface || "",
    description: componentData.description || "",
    props: componentData.props || [],
    variantProperties: componentData.variantProperties || {},
    totalProps: componentData.totalProps || 0,
    potentialFigmaMapping: componentData.potentialFigmaMapping || {}
  };
}

/**
 * Write component data to YAML file
 */
async function writeComponentFile(config, componentName, yamlData) {
  const fileName = `${componentName.toLowerCase()}.yaml`;
  const outputPath = path.join(config.output, fileName);
  
  if (!config.overwrite && fs.existsSync(outputPath)) {
    console.warn(`⚠️  File exists: ${fileName} (use --overwrite to replace)`);
    return false;
  }
  
  if (config.dryRun) {
    console.log(`📝 Would write: ${fileName}`);
    if (config.verbose) {
      console.log(YAML.stringify(yamlData, { indent: 2 }));
    }
    return true;
  }
  
  try {
    await fs.ensureDir(config.output);
    const yamlContent = YAML.stringify(yamlData, { indent: 2 });
    await fs.writeFile(outputPath, yamlContent, 'utf8');
    console.log(`✅ Generated: ${fileName}`);
    return true;
  } catch (error) {
    console.error(`❌ Error writing ${fileName}:`, error.message);
    return false;
  }
}

/**
 * Main extraction process
 */
async function extractComponentProps(config) {
  console.log('🔍 Scanning for React components...\n');
  
  // Validate input directory
  if (!fs.existsSync(config.input)) {
    console.error(`❌ Input directory not found: ${config.input}`);
    process.exit(1);
  }
  
  // Scan for files
  const files = scanDirectory(config.input);
  console.log(`📁 Found ${files.length} TypeScript files in ${config.input}`);
  
  if (files.length === 0) {
    console.log('ℹ️  No TypeScript files found to process');
    return;
  }
  
  // Extract components
  let totalComponents = 0;
  let successfulWrites = 0;
  
  for (const file of files) {
    if (config.verbose) {
      console.log(`\n🔄 Processing: ${path.relative(process.cwd(), file)}`);
    }
    
    const components = parseComponent(file);
    
    for (const component of components) {
      // Apply filter if specified
      if (config.filter && !component.componentName.toLowerCase().includes(config.filter.toLowerCase())) {
        continue;
      }
      
      totalComponents++;
      
      if (config.verbose) {
        console.log(`  📦 Found component: ${component.componentName}`);
        console.log(`     Props: ${component.props.length}`);
        console.log(`     Interface: ${component.interfaceName || 'none'}`);
        
        if (Object.keys(component.variantProperties).length > 0) {
          console.log(`     Variants: ${Object.keys(component.variantProperties).join(', ')}`);
        }
      }
      
      // Generate and write YAML
      const yamlData = generateComponentYAML(component);
      const success = await writeComponentFile(config, component.componentName, yamlData);
      if (success) successfulWrites++;
    }
  }
  
  // Summary
  console.log(`\n📊 Extraction Summary:`);
  console.log(`   Files processed: ${files.length}`);
  console.log(`   Components found: ${totalComponents}`);
  console.log(`   YAML files ${config.dryRun ? 'previewed' : 'written'}: ${successfulWrites}`);
  
  if (config.dryRun) {
    console.log(`\n💡 Run without --dry-run to write files to ${config.output}/`);
  } else {
    console.log(`\n✨ Component props extracted to ${config.output}/ directory`);
  }
}

/**
 * Main entry point
 */
async function main() {
  try {
    const config = parseArgs();
    
    if (config.verbose) {
      console.log('⚙️  Configuration:');
      console.log(`   Input: ${config.input}`);
      console.log(`   Output: ${config.output}`);
      console.log(`   Dry run: ${config.dryRun}`);
      console.log(`   Filter: ${config.filter || 'none'}`);
      console.log('');
    }
    
    await extractComponentProps(config);
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    if (error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  extractComponentProps,
  parseComponent,
  scanDirectory
};