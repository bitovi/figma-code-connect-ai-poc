#!/usr/bin/env node

/**
 * Figma Component Variants Extractor
 *
 * This script downloads all variants from Figma components and saves them as JSON/YAML files.
 *
 * Usage:
 *   node figma-variants-extractor.js <fileKey> [options]
 *
 * Options:
 *   --token       Figma API token (or set FIGMA_ACCESS_TOKEN env variable)
 *   --page        Specific page name to process (default: all pages)
 *   --component   Specific component name to process (default: all components)
 *   --format      Output format: json, yaml, or both (default: both)
 *   --output      Output directory (default: ./figma-variants)
 *
 * Example:
 *   FIGMA_ACCESS_TOKEN=xxx node figma-variants-extractor.js abc123xyz
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// YAML converter (simple implementation)
function toYAML(obj, indent = 0) {
  const spaces = '  '.repeat(indent);
  let yaml = '';

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      yaml += `${spaces}${key}: null\n`;
    } else if (Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`;
      value.forEach(item => {
        if (typeof item === 'object') {
          yaml += `${spaces}- \n${toYAML(item, indent + 1)}`;
        } else {
          yaml += `${spaces}- ${item}\n`;
        }
      });
    } else if (typeof value === 'object') {
      yaml += `${spaces}${key}:\n${toYAML(value, indent + 1)}`;
    } else if (typeof value === 'string') {
      yaml += `${spaces}${key}: "${value}"\n`;
    } else {
      yaml += `${spaces}${key}: ${value}\n`;
    }
  }

  return yaml;
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    fileKey: args[0],
    token: process.env.FIGMA_ACCESS_TOKEN,
    page: null,
    component: null,
    format: 'both',
    output: './figma-variants'
  };

  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case '--token':
        config.token = value;
        break;
      case '--page':
        config.page = value;
        break;
      case '--component':
        config.component = value;
        break;
      case '--format':
        config.format = value;
        break;
      case '--output':
        config.output = value;
        break;
    }
  }

  return config;
}

// Make HTTPS request to Figma API
function figmaRequest(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.figma.com',
      path: path,
      method: 'GET',
      headers: {
        'X-Figma-Token': token
      }
    };

    https.get(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Figma API error: ${res.statusCode} - ${data}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Recursively find all component sets in the node tree
function findComponentSets(node, componentSets = []) {
  if (node.type === 'COMPONENT_SET') {
    componentSets.push(node);
  }

  if (node.children) {
    for (const child of node.children) {
      findComponentSets(child, componentSets);
    }
  }

  return componentSets;
}

// Extract variant information from a component set
function extractVariants(componentSet) {
  const variants = [];
  const propertyOptions = {};

  // Process each child component (each is a variant)
  if (componentSet.children) {
    for (const variant of componentSet.children) {
      if (variant.type === 'COMPONENT') {
        const variantData = {
          variantId: variant.id,
          name: variant.name,
          properties: {}
        };

        // Parse properties from the name (format: "Property=Value, Property2=Value2")
        if (variant.name) {
          const propertyPairs = variant.name.split(',').map(p => p.trim());
          for (const pair of propertyPairs) {
            const [prop, value] = pair.split('=').map(s => s.trim());
            if (prop && value) {
              variantData.properties[prop] = value;

              // Track all possible values for each property
              if (!propertyOptions[prop]) {
                propertyOptions[prop] = new Set();
              }
              propertyOptions[prop].add(value);
            }
          }
        }

        // Add additional metadata
        variantData.description = variant.description || '';
        variantData.key = variant.key || '';

        variants.push(variantData);
      }
    }
  }

  // Convert Sets to Arrays
  const propertyOptionsArray = {};
  for (const [prop, values] of Object.entries(propertyOptions)) {
    propertyOptionsArray[prop] = Array.from(values).sort();
  }

  return {
    componentSetId: componentSet.id,
    componentName: componentSet.name,
    description: componentSet.description || '',
    variantProperties: propertyOptionsArray,
    variants: variants,
    totalVariants: variants.length
  };
}

// Save data to file
function saveFile(filePath, data, format) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let content;
  if (format === 'json') {
    content = JSON.stringify(data, null, 2);
  } else if (format === 'yaml') {
    content = toYAML(data);
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✓ Saved: ${filePath}`);
}

// Sanitize filename
function sanitizeFilename(name) {
  return name
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
}

// Main execution
async function main() {
  const config = parseArgs();

  // Validate inputs
  if (!config.fileKey) {
    console.error('Error: Figma file key is required');
    console.error('Usage: node figma-variants-extractor.js <fileKey> [options]');
    process.exit(1);
  }

  if (!config.token) {
    console.error('Error: Figma API token is required');
    console.error('Set FIGMA_ACCESS_TOKEN environment variable or use --token flag');
    process.exit(1);
  }

  console.log('🎨 Fetching Figma file...');
  console.log(`File Key: ${config.fileKey}`);

  try {
    // Fetch file data from Figma API
    const fileData = await figmaRequest(`/v1/files/${config.fileKey}`, config.token);

    console.log(`✓ File loaded: ${fileData.name}`);
    console.log(`  Version: ${fileData.version}`);
    console.log(`  Last Modified: ${fileData.lastModified}`);

    // Find all component sets
    let allComponentSets = [];

    for (const page of fileData.document.children) {
      // Filter by page if specified
      if (config.page && page.name !== config.page) {
        continue;
      }

      console.log(`\n📄 Processing page: ${page.name}`);
      const componentSets = findComponentSets(page);
      allComponentSets = allComponentSets.concat(componentSets);
    }

    console.log(`\n✓ Found ${allComponentSets.length} component sets`);

    // Process each component set
    let processedCount = 0;
    for (const componentSet of allComponentSets) {
      // Filter by component name if specified
      if (config.component && componentSet.name !== config.component) {
        continue;
      }

      console.log(`\n🔧 Processing: ${componentSet.name}`);

      const variantData = extractVariants(componentSet);
      console.log(`  Variants: ${variantData.totalVariants}`);
      console.log(`  Properties: ${Object.keys(variantData.variantProperties).join(', ')}`);

      // Save files
      const filename = sanitizeFilename(componentSet.name);

      if (config.format === 'json' || config.format === 'both') {
        const jsonPath = path.join(config.output, `${filename}.json`);
        saveFile(jsonPath, variantData, 'json');
      }

      if (config.format === 'yaml' || config.format === 'both') {
        const yamlPath = path.join(config.output, `${filename}.yaml`);
        saveFile(yamlPath, variantData, 'yaml');
      }

      processedCount++;
    }

    // Create index file with all components
    if (processedCount > 0) {
      const indexData = {
        fileName: fileData.name,
        fileKey: config.fileKey,
        version: fileData.version,
        lastModified: fileData.lastModified,
        exportDate: new Date().toISOString(),
        components: allComponentSets
            .filter(cs => !config.component || cs.name === config.component)
            .map(cs => ({
              name: cs.name,
              id: cs.id,
              variantCount: cs.children ? cs.children.length : 0
            }))
      };

      if (config.format === 'json' || config.format === 'both') {
        saveFile(path.join(config.output, 'index.json'), indexData, 'json');
      }

      if (config.format === 'yaml' || config.format === 'both') {
        saveFile(path.join(config.output, 'index.yaml'), indexData, 'yaml');
      }
    }

    console.log(`\n✅ Complete! Processed ${processedCount} component(s)`);
    console.log(`📁 Output directory: ${config.output}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
