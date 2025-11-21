#!/usr/bin/env node

/**
 * Figma Component Variants Extractor (JSON-only)
 *
 * Downloads all variants from Figma components and saves them as JSON files.
 *
 * Usage:
 *   node scripts/fetchComponents.js [fileKey] [options]
 *
 * Options:
 *   --token       Figma API token (or set FIGMA_ACCESS_TOKEN env variable)
 *   --page        Specific page name to process (default: all pages)
 *   --component   Specific component name to process (default: all components)
 *   --output      Output directory (default: ./figma-variants)
 *   --file-key    Figma file key or full Figma URL
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

function parseFileKey(input) {
  if (!input) return '';
  const urlMatch = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]{10,})/);
  return urlMatch ? urlMatch[1] : input;
}

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length) {
        const value = rest.join('=').trim();
        if (!process.env[key]) process.env[key] = value;
      }
    });
  }
}

function parseArgs() {
  loadEnvFile();
  const args = process.argv.slice(2);
  const inlineFileKey = args[0] && !args[0].startsWith('--') ? parseFileKey(args[0]) : null;
  const config = {
    fileKey: inlineFileKey || '',
    token: process.env.FIGMA_ACCESS_TOKEN,
    page: null,
    component: null,
    output: './figma-variants'
  };

  for (let i = inlineFileKey ? 1 : 0; i < args.length; i += 2) {
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
      case '--output':
        config.output = value;
        break;
      case '--file-key':
        config.fileKey = parseFileKey(value);
        break;
    }
  }
  return config;
}

function figmaRequest(pathname, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.figma.com',
      path: pathname,
      method: 'GET',
      headers: { 'X-Figma-Token': token }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Figma API error: ${res.statusCode} - ${data}`));
        }
      });
    }).on('error', (err) => reject(err));
  });
}

function findComponentSets(node, acc = []) {
  if (node.type === 'COMPONENT_SET') acc.push(node);
  if (node.children) node.children.forEach((child) => findComponentSets(child, acc));
  return acc;
}

function extractVariants(componentSet) {
  const variants = [];
  const propertyOptions = {};

  if (componentSet.children) {
    for (const variant of componentSet.children) {
      if (variant.type !== 'COMPONENT') continue;
      const variantData = {
        variantId: variant.id,
        name: variant.name,
        properties: {},
        description: variant.description || '',
        key: variant.key || ''
      };
      if (variant.name) {
        const propertyPairs = variant.name.split(',').map((p) => p.trim());
        for (const pair of propertyPairs) {
          const [prop, value] = pair.split('=').map((s) => s.trim());
          if (prop && value) {
            variantData.properties[prop] = value;
            if (!propertyOptions[prop]) propertyOptions[prop] = new Set();
            propertyOptions[prop].add(value);
          }
        }
      }
      variants.push(variantData);
    }
  }

  const propertyOptionsArray = {};
  Object.entries(propertyOptions).forEach(([prop, values]) => {
    propertyOptionsArray[prop] = Array.from(values).sort();
  });

  return {
    componentSetId: componentSet.id,
    componentName: componentSet.name,
    description: componentSet.description || '',
    variantProperties: propertyOptionsArray,
    variants,
    totalVariants: variants.length
  };
}

function saveJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✓ Saved: ${filePath}`);
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').toLowerCase();
}

async function main() {
  const config = parseArgs();
  if (!config.fileKey) {
    console.error('Error: Figma file key is required');
    process.exit(1);
  }
  if (!config.token) {
    console.error('Error: Figma API token is required (set FIGMA_ACCESS_TOKEN or use --token)');
    process.exit(1);
  }

  console.log('🎨 Fetching Figma file...');
  console.log(`File Key: ${config.fileKey}`);

  try {
    const fileData = await figmaRequest(`/v1/files/${config.fileKey}`, config.token);
    console.log(`✓ File loaded: ${fileData.name}`);
    console.log(`  Version: ${fileData.version}`);
    console.log(`  Last Modified: ${fileData.lastModified}`);

    let allComponentSets = [];
    for (const page of fileData.document.children) {
      if (config.page && page.name !== config.page) continue;
      console.log(`\n📄 Processing page: ${page.name}`);
      const componentSets = findComponentSets(page);
      allComponentSets = allComponentSets.concat(componentSets);
    }

    console.log(`\n✓ Found ${allComponentSets.length} component sets`);

    let processedCount = 0;
    for (const componentSet of allComponentSets) {
      if (config.component && componentSet.name !== config.component) continue;
      console.log(`\n🔧 Processing: ${componentSet.name}`);

      const variantData = extractVariants(componentSet);
      console.log(`  Variants: ${variantData.totalVariants}`);
      console.log(`  Properties: ${Object.keys(variantData.variantProperties).join(', ')}`);

      const filename = sanitizeFilename(componentSet.name);
      const jsonPath = path.join(config.output, `${filename}.json`);
      saveJson(jsonPath, variantData);
      processedCount++;
    }

    if (processedCount > 0) {
      const indexData = {
        fileName: fileData.name,
        fileKey: config.fileKey,
        version: fileData.version,
        lastModified: fileData.lastModified,
        exportDate: new Date().toISOString(),
        components: allComponentSets
          .filter((cs) => !config.component || cs.name === config.component)
          .map((cs) => ({
            name: cs.name,
            id: cs.id,
            variantCount: cs.children ? cs.children.length : 0
          }))
      };
      saveJson(path.join(config.output, 'index.json'), indexData);
    }

    console.log(`\n✅ Complete! Processed ${processedCount} component(s)`);
    console.log(`📁 Output directory: ${config.output}`);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
