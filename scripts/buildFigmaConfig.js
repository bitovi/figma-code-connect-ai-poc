#!/usr/bin/env node

/**
 * Figma Config Builder
 *
 * This script reads YAML files from the figma-variants directory and generates
 * documentUrlSubstitutions entries for figma.config.json
 *
 * Usage:
 *   node buildFigmaConfig.js [options]
 *
 * Options:
 *   --input       Input directory with YAML files (default: ./figma-variants)
 *   --output      Output format: json, console, or file (default: console)
 *   --file-key    Figma file key or full Figma URL
 *   --parser      Parser type: react, html, swift, compose (default: react)
 *   --include     Include paths (comma-separated, shows as empty array if not provided)
 *   --exclude     Exclude paths (comma-separated, shows as empty array if not provided)
 *   --import-paths Import path mappings (format: "src=>@ui,components/**=>@ui/components")
 *   --paths       TypeScript path mappings (format: "@ui/*=>src/components/*,@theme/*=>src/theme/*")
 *   --manifest    Manifest JSON/YAML (default: artifacts/codeconnect-manifest.json) for default import/paths
 *   --custom-subs Custom URL substitutions (format: "<FIGMA_ICONS_BASE>=>/design/file,<CUSTOM>=>/other")
 *
 * Generated Config Structure:
 *   The script always shows all configurable properties in the output, even if empty.
 *   This allows users to see what's available and manually edit the config file.
 *   Empty arrays/objects contain example values as guidance.
 *
 * Examples:
 *   # Output to console (default)
 *   node buildFigmaConfig.js
 *   
 *   # Generate Chakra-style configuration
 *   node buildFigmaConfig.js --output file --include "packages/react/**" --custom-subs "<FIGMA_ICONS_BASE>=>/design/mgzCV3zD3iWpctEI6UoUhB"
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const YAML = require('yaml');

const DEFAULT_MANIFEST = 'artifacts/codeconnect-manifest.json';

// Load environment variables from .env file
function parseFileKey(input) {
  if (!input) return '';
  const urlMatch = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]{10,})/);
  return urlMatch ? urlMatch[1] : input;
}

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '../.env');
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          // Only set if not already defined in process.env
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  }
}

// Function to prompt user for file override
function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim());
    });
  });
}

// Function to check if file should be overwritten
async function checkFileOverwrite(filePath) {
  if (!fs.existsSync(filePath)) {
    return true; // File doesn't exist, safe to write
  }

  console.log(`\n⚠️  File ${filePath} already exists.`);
  const answer = await promptUser('Do you want to override it? (y/N): ');
  
  return answer === 'y' || answer === 'yes';
}

// Parse command line arguments
function parseArgs() {
  // Load .env file first
  loadEnvFile();
  
  const args = process.argv.slice(2);
  const config = {
    input: './figma-variants',
    output: 'console',
    fileKey: '',
    parser: 'react',
    manifest: DEFAULT_MANIFEST,
    include: null, // Will be empty array only if user provides values
    exclude: null, // Will be empty array only if user provides values
    importPaths: null, // Will be empty object only if user provides values
    paths: null, // Will be empty object only if user provides values
    customSubstitutions: null // Will be empty object only if user provides values
  };

  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case '--input':
        config.input = value;
        break;
      case '--output':
        config.output = value;
        break;
      case '--file-key':
        config.fileKey = parseFileKey(value);
        break;
      case '--parser':
        config.parser = value;
        break;
      case '--include':
        config.include = value ? value.split(',').map(s => s.trim()) : [];
        break;
      case '--exclude':
        config.exclude = value ? value.split(',').map(s => s.trim()) : [];
        break;
      case '--manifest':
        config.manifest = value;
        break;
      case '--import-paths':
        // Parse format: "src=>@ui,components/**=>@ui/components"
        if (value) {
          const pairs = value.split(',');
          config.importPaths = {};
          pairs.forEach(pair => {
            const [key, val] = pair.split('=>').map(s => s.trim());
            if (key && val) {
              config.importPaths[key] = val;
            }
          });
        }
        break;
      case '--paths':
        // Parse format: "@ui/*=>src/components/*,@theme/*=>src/theme/*"
        if (value) {
          const pairs = value.split(',');
          config.paths = {};
          pairs.forEach(pair => {
            const [key, val] = pair.split('=>').map(s => s.trim());
            if (key && val) {
              // Convert single value to array as TypeScript paths expect arrays
              config.paths[key] = [val];
            }
          });
        }
        break;
      case '--custom-subs':
        // Parse format: "<FIGMA_ICONS_BASE>=>/design/file,<CUSTOM>=>/other"
        if (value) {
          const pairs = value.split(',');
          config.customSubstitutions = {};
          pairs.forEach(pair => {
            const [key, val] = pair.split('=>').map(s => s.trim());
            if (key && val) {
              // If value starts with /, prepend the base Figma URL
              const fullUrl = val.startsWith('/') 
                ? `https://www.figma.com/design${val}`
                : val;
              config.customSubstitutions[key] = fullUrl;
            }
          });
        }
        break;
    }
  }

  return config;
}

// Simple YAML parser for our specific use case
function parseYamlHeader(yamlContent) {
  const lines = yamlContent.split('\n');
  const result = {};
  
  for (const line of lines.slice(0, 10)) { // Only check first 10 lines for efficiency
    const trimmedLine = line.trim();
    if (trimmedLine.includes(':')) {
      const [key, ...valueParts] = trimmedLine.split(':');
      if (key && valueParts.length > 0) {
        const value = valueParts.join(':').trim().replace(/^["']|["']$/g, ''); // Remove quotes
        result[key.trim()] = value;
      }
    }
  }
  
  return result;
}

// Convert component name to substitution key format
function componentNameToKey(componentName) {
  // Skip invalid component names
  if (!componentName || componentName.trim() === '' || componentName === '-' || componentName === '_') {
    return null;
  }
  
  // Convert "Avatar" -> "<AVATAR>"
  // Convert "AvatarGroup" -> "<AVATAR_GROUP>" 
  // Convert "Data Cells" -> "<DATA_CELLS>"
  // Convert "Select.Content" -> "<SELECT_CONTENT>"
  // Convert "Stat.Items" -> "<STAT_ITEMS>"
  const key = componentName
    .replace(/\./g, '_')           // Replace dots with underscores
    .replace(/\s+/g, '_')          // Replace spaces with underscores  
    .replace(/([A-Z])/g, '_$1')    // Insert underscore before capital letters
    .toUpperCase()                 // Convert to uppercase
    .replace(/^_/, '')             // Remove leading underscore
    .replace(/_+/g, '_')           // Replace multiple underscores with single
    .trim();                       // Trim whitespace
  
  // Skip if result is empty, just underscores, or other invalid patterns
  if (!key || key === '_' || key === '' || /^_+$/.test(key)) {
    return null;
  }
  
  return `<${key}>`;
}

// Generate Figma URL for a component
function generateFigmaUrl(fileKey, componentSetId) {
  // Convert colon format to hyphen format to match manual config
  const nodeId = componentSetId.replace(/:/g, '-');
  return `https://www.figma.com/design/${fileKey}/?node-id=${nodeId}`;
}

// Process YAML files in directory
function processYamlFiles(inputDir) {
  const components = [];
  
  if (!fs.existsSync(inputDir)) {
    console.error(`Error: Input directory '${inputDir}' does not exist`);
    process.exit(1);
  }
  
  console.log(`📁 Reading YAML files from: ${inputDir}`);
  
  const files = fs.readdirSync(inputDir);
  const yamlFiles = files.filter(file => file.endsWith('.yaml'));
  
  console.log(`🔍 Found ${yamlFiles.length} YAML files`);
  
  for (const file of yamlFiles) {
    const filePath = path.join(inputDir, file);
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const yamlData = parseYamlHeader(content);
      
      if (yamlData.componentSetId && yamlData.componentName) {
        components.push({
          file: file,
          componentSetId: yamlData.componentSetId,
          componentName: yamlData.componentName,
          description: yamlData.description || ''
        });
        
        console.log(`  ✓ ${file}: ${yamlData.componentName} (${yamlData.componentSetId})`);
      } else {
        console.log(`  ⚠️  ${file}: Missing componentSetId or componentName`);
      }
    } catch (error) {
      console.log(`  ❌ ${file}: Error reading file - ${error.message}`);
    }
  }
  
  return components;
}

// Generate documentUrlSubstitutions object
function generateFigmaConfig(components, fileKey, parser = 'react', options = {}) {
  const { 
    include = null, 
    exclude = null, 
    importPaths = null,
    paths = null,
    customSubstitutions = null
  } = options;
  
  const substitutions = {};
  
  // Add custom substitutions first (like <FIGMA_ICONS_BASE>)
  if (customSubstitutions && Object.keys(customSubstitutions).length > 0) {
    Object.assign(substitutions, customSubstitutions);
  }
  
  // Add component substitutions
  for (const component of components) {
    const key = componentNameToKey(component.componentName);
    
    // Skip invalid keys
    if (!key) {
      console.warn(`Skipping invalid component name: "${component.componentName}" in ${component.file}`);
      continue;
    }
    
    const url = generateFigmaUrl(fileKey, component.componentSetId);
    substitutions[key] = url;
  }
  
  // Base configuration in correct order to match manual config
  const config = {
    codeConnect: {
      interactiveSetupFigmaFileUrl: `https://www.figma.com/design/${fileKey}`,
      // Always show include/exclude arrays (populated or empty for user guidance)
      include: include && include.length > 0 ? include : [],
      exclude: exclude && exclude.length > 0 ? exclude : [],
      parser: parser,
      documentUrlSubstitutions: substitutions
    }
  };
  
  // Add React-specific configuration (always show for React parser)
  if (parser === 'react') {
    // Show importPaths and paths even if empty, so users know they can configure them
    config.codeConnect.importPaths = importPaths && Object.keys(importPaths).length > 0 
      ? importPaths 
      : {
          // Follow Figma Code Connect standards - override relative imports
          // Format: "directory_pattern": "package_name"
          "src/components/*": "@ui/components"
        };
    
    config.codeConnect.paths = paths && Object.keys(paths).length > 0 
      ? paths 
      : {
          // TypeScript path mappings - must match your tsconfig.json paths
          // Format: "alias": ["resolved_path"]
          "@ui/components/*": ["src/components/*"]
        };
  }
  
  // Reorder to put documentUrlSubstitutions at the end
  const substitutionsTemp = config.codeConnect.documentUrlSubstitutions;
  delete config.codeConnect.documentUrlSubstitutions;
  config.codeConnect.documentUrlSubstitutions = substitutionsTemp;
  
  return config;
}

function loadManifestIfAvailable(manifestPath) {
  if (!manifestPath) return null;
  const resolved = path.resolve(manifestPath);
  if (!fs.existsSync(resolved)) {
    console.warn(`ℹ️  Manifest not found at ${resolved}; proceeding without it.`);
    return null;
  }
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    try {
      return YAML.parse(raw);
    } catch (yamlErr) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn(`⚠️  Could not read manifest at ${resolved}: ${err.message}`);
    return null;
  }
}

function deriveImportPathsFromManifest(manifest) {
  if (!manifest) return null;
  const importTarget = manifest.importTarget;
  const componentRoot = manifest.componentRoot;
  if (!importTarget || !componentRoot) return null;
  const normalizedRoot = componentRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const map = {};
  map[`${normalizedRoot}/**`] = importTarget;
  return map;
}

function derivePathsFromManifest(manifest) {
  if (!manifest || !manifest.tsconfigPaths) return null;
  return manifest.tsconfigPaths;
}

// Output results
async function outputResults(figmaConfig, outputFormat, components) {
  switch (outputFormat) {
    case 'console':
      console.log('\n📋 Generated Figma Config:');
      console.log('=========================\n');
      console.log(JSON.stringify(figmaConfig, null, 2));
      break;
      
    case 'json':
      console.log(JSON.stringify(figmaConfig, null, 2));
      break;
      
    case 'file': {
      const outputPath = './figma.config.json';
      
      // Check if file exists and ask for permission to overwrite
      const shouldWrite = await checkFileOverwrite(outputPath);
      
      if (!shouldWrite) {
        console.log('\n❌ Operation cancelled. File not modified.');
        return;
      }
      
      fs.writeFileSync(outputPath, JSON.stringify(figmaConfig, null, 2), 'utf8');
      console.log(`\n✅ Generated config saved to: ${outputPath}`);
      console.log(`📊 Total components: ${components.length}`);
      break;
    }
      
    default:
      console.error(`Error: Unknown output format '${outputFormat}'. Use 'console', 'json', or 'file'.`);
      process.exit(1);
  }
}

// Main execution
async function main() {
  const config = parseArgs();
  const manifest = loadManifestIfAvailable(config.manifest);

  // Validate inputs
  if (!config.fileKey) {
    console.error('Error: Figma file key is required');
    console.error('Provide it with: --file-key <key|Figma URL>');
    process.exit(1);
  }

  console.log('🎨 Building Figma Config...');
  console.log(`File Key: ${config.fileKey}`);
  console.log(`Input Directory: ${config.input}`);
  console.log(`Output Format: ${config.output}`);
  console.log(`Parser: ${config.parser}`);
  if (manifest) {
    console.log(`Manifest: ${path.resolve(config.manifest)}\n`);
  } else {
    console.log('');
  }

  try {
    // Process YAML files
    const components = processYamlFiles(config.input);
    
    if (components.length === 0) {
      console.log('\n⚠️  No valid components found');
      process.exit(0);
    }
    
    // Generate config
    const figmaConfig = generateFigmaConfig(components, config.fileKey, config.parser, {
      include: config.include,
      exclude: config.exclude,
      importPaths: config.importPaths || deriveImportPathsFromManifest(manifest),
      paths: config.paths || derivePathsFromManifest(manifest),
      customSubstitutions: config.customSubstitutions
    });
    
    // Output results
    await outputResults(figmaConfig, config.output, components);
    
    console.log(`\n✅ Complete! Processed ${components.length} component(s)`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
